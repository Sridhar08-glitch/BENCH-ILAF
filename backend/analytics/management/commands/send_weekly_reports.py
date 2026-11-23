"""E-mail the weekly reports. Run once a week from cron (Monday morning UTC), for example:

    0 7 * * 1 cd /path/to/backend && .venv/bin/python manage.py send_weekly_reports

It reports on the last full ISO week. Running it again for the same week sends nothing twice (every
sent report is recorded). `--dry-run` only prints how many reports would go out.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError

from analytics import weekly
from analytics.models import ReportPreference, WeeklyReportLog
from workspaces.models import Member


class Command(BaseCommand):
    help = "Send the weekly report e-mails for the last full week (or --week 2026-W46)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Count the reports, send nothing, record nothing.")
        parser.add_argument("--week", help="An ISO week such as 2026-W46. Default: the last full week.")
        parser.add_argument("--only", choices=("personal", "company"), help="Send only one kind.")
        parser.add_argument("--batch-size", type=int, default=200, help="People handled per database round trip.")

    def handle(self, *args, **options):
        try:
            week = weekly.parse_week(options["week"]) if options["week"] else weekly.last_full_week()
        except ValueError as exc:
            raise CommandError(str(exc))
        dry = options["dry_run"]
        stats = {"personal_sent": 0, "company_sent": 0, "already_sent": 0, "switched_off": 0, "quiet": 0, "failed": 0}
        members = (
            Member.objects.filter(
                status="active", user__isnull=False, user__is_active=True, workspace__deleted_at__isnull=True,
                workspace__deletion_due_at__isnull=True,
            )
            .select_related("user", "workspace")
            .order_by("id")
        )
        batch = []
        for member in members.iterator(chunk_size=options["batch_size"]):
            batch.append(member)
            if len(batch) >= options["batch_size"]:
                self._run(batch, week, dry, options["only"], stats)
                batch = []
        if batch:
            self._run(batch, week, dry, options["only"], stats)
        label = "Would send" if dry else "Sent"
        self.stdout.write(
            f"Week {week.year}-W{week.week:02d}. {label}: {stats['personal_sent']} personal, {stats['company_sent']} company. "
            f"Already sent {stats['already_sent']}, switched off {stats['switched_off']}, nothing to report {stats['quiet']}, "
            f"failed {stats['failed']}."
        )

    def _run(self, members, week, dry, only, stats):
        user_ids = {m.user_id for m in members}
        ws_ids = {m.workspace_id for m in members}
        prefs = {
            (p.user_id, p.workspace_id): p
            for p in ReportPreference.objects.filter(user_id__in=user_ids, workspace_id__in=ws_ids)
        }
        done = set(
            WeeklyReportLog.objects.filter(
                user_id__in=user_ids, workspace_id__in=ws_ids, iso_year=week.year, iso_week=week.week
            ).values_list("user_id", "workspace_id", "kind")
        )
        for member in members:
            pref = prefs.get((member.user_id, member.workspace_id))
            kinds = [("personal", pref.personal_report if pref else True)]
            if member.role in ("owner", "admin") and member.workspace.kind == "company":
                kinds.append(("company", pref.company_report if pref else True))
            for kind, wanted in kinds:
                if only and kind != only:
                    continue
                if not wanted:
                    stats["switched_off"] += 1
                    continue
                if (member.user_id, member.workspace_id, kind) in done:
                    stats["already_sent"] += 1
                    continue
                if kind == "personal" and not self._worth_sending(member, week):
                    stats["quiet"] += 1
                    continue
                if dry:
                    stats[f"{kind}_sent"] += 1
                    continue
                self._send_one(member, kind, week, stats)

    @staticmethod
    def _worth_sending(member, week):
        """A person with no card, or with nothing at all in both weeks, gets no report."""
        if not weekly.own_cards(member).exists():
            return False
        return weekly.has_activity(weekly.personal_data(member, week))

    def _send_one(self, member, kind, week, stats):
        # The log row is the claim: a second run (or a second worker) hits the unique key and skips.
        try:
            log = WeeklyReportLog.objects.create(
                user=member.user, workspace=member.workspace, kind=kind, iso_year=week.year, iso_week=week.week
            )
        except IntegrityError:
            stats["already_sent"] += 1
            return
        try:
            weekly.send(member, kind, week)
        except Exception as exc:  # the mail server said no: free the claim so the next run tries again
            log.delete()
            stats["failed"] += 1
            self.stderr.write(f"Could not send to {member.user.email}: {type(exc).__name__}")
            return
        stats[f"{kind}_sent"] += 1
