"""E-mail the daily summary to people who switched it on. Run every hour from cron:

    5 * * * * cd /path/to/backend && .venv/bin/python manage.py send_daily_summary

Each person gets it in their own morning (their time zone, Asia/Qatar when none is set), once a day: running it again
sends nothing twice. `--dry-run` only counts."""
from django.core.management.base import BaseCommand

from notify import services


class Command(BaseCommand):
    help = "Send the daily summary e-mails that are due."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Count the summaries, send nothing, record nothing.")

    def handle(self, *args, **options):
        stats = services.run_daily_summary(dry_run=options["dry_run"])
        label = "Would send" if options["dry_run"] else "Sent"
        self.stdout.write(
            f"{label}: {stats['sent']}. Nothing to report {stats['quiet']}, not their morning yet {stats['not_yet']}, "
            f"already sent today {stats['already']}, failed {stats['failed']}."
        )
