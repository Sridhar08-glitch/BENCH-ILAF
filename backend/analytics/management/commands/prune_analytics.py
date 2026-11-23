"""Keep the database from growing without limit. Run once a day from cron:

    manage.py prune_analytics

What it does
  * Visitor events older than ANALYTICS_RETENTION_DAYS (default 400) are rolled up, not lost: all events of one card with
    the same type, source, button, country and device inside the same quarter of an hour become one row with a
    `weight` (the number of events it stands for) and no visitor hash. Every analytics number adds up weights, so
    views, scans, taps, saves, button clicks, the hour-of-day chart and the day/week/month series come out the same.
    The only figure that cannot survive is "unique visitors" for days older than the retention (a visitor
    hash is a per-day secret and is the one thing removed).
  * Finished webhook deliveries older than 90 days are deleted (they hold copies of lead data).
  * Password-reset rows older than a day are deleted, and the link of an invitation that expired a week ago is cleared
    (a resend makes a new one).
  * Audit entries are never touched.

Running it twice, or stopping it half way, is safe: each batch is one transaction.
"""
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from accounts.models import PasswordResetToken
from analytics.models import Event
from leads import webhooks
from leads.models import WebhookDelivery
from workspaces.models import Member

BUCKET_MINUTES = 15


def bucket_start(moment):
    return moment.replace(minute=moment.minute - moment.minute % BUCKET_MINUTES, second=0, microsecond=0)


def roll_up_events(cutoff, batch=5000, dry_run=False, max_batches=None):
    """Roll up every unrolled event older than `cutoff`. Returns (rows rolled, summary rows written)."""
    cutoff = bucket_start(cutoff)
    if dry_run:
        return Event.objects.filter(rolled=False, created_at__lt=cutoff).count(), 0
    rolled_rows = written = 0
    batches = 0
    while max_batches is None or batches < max_batches:
        rows = list(
            Event.objects.filter(rolled=False, created_at__lt=cutoff).order_by("id")
            .values_list("id", "card_id", "type", "source", "kind", "country", "device", "created_at", "weight")[:batch]
        )
        if not rows:
            break
        groups = {}
        for pk, card_id, kind_type, source, kind, country, device, created, weight in rows:
            key = (card_id, kind_type, source, kind, country, device, bucket_start(created))
            groups[key] = groups.get(key, 0) + weight
        with transaction.atomic():
            for (card_id, kind_type, source, kind, country, device, start), total in groups.items():
                same = Event.objects.filter(
                    rolled=True, card_id=card_id, type=kind_type, source=source, kind=kind, country=country,
                    device=device, created_at=start,
                ).first()
                if same is not None:
                    Event.objects.filter(pk=same.pk).update(weight=F("weight") + total)
                else:
                    event = Event.objects.create(
                        card_id=card_id, type=kind_type, source=source, kind=kind, country=country, device=device,
                        visitor_hash="", weight=total, rolled=True,
                    )
                    Event.objects.filter(pk=event.pk).update(created_at=start)  # auto_now_add cannot be set on create
            Event.objects.filter(pk__in=[r[0] for r in rows], rolled=False).delete()
        rolled_rows += len(rows)
        written += len(groups)
        batches += 1
    return rolled_rows, written


def prune_other(now, webhook_days=90, dry_run=False):
    counts = {}
    old_hooks = WebhookDelivery.objects.filter(created_at__lt=now - timedelta(days=webhook_days)).exclude(status="pending")
    counts["webhook_deliveries"] = old_hooks.count()
    resets = PasswordResetToken.objects.filter(created_at__lt=now - timedelta(days=1))
    counts["password_resets"] = resets.count()
    stale = timedelta(days=settings.INVITE_LIFETIME_DAYS + 7)
    invites = Member.objects.filter(status="invited", invite_token__isnull=False).exclude(invite_token="")
    expired = [
        m.pk for m in invites.only("id", "invited_at", "invite_sent_at")
        if now - (m.invite_sent_at or m.invited_at) > stale
    ]
    counts["invite_links"] = len(expired)
    if not dry_run:
        webhooks.prune(webhook_days)
        resets.delete()
        Member.objects.filter(pk__in=expired).update(invite_token=None)
    return counts


class Command(BaseCommand):
    help = "Roll up old visitor events and delete old webhook deliveries, reset tokens and expired invitation links."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=None, help="Keep raw events this many days (default ANALYTICS_RETENTION_DAYS, 400).")
        parser.add_argument("--webhook-days", type=int, default=90, help="Delete finished webhook deliveries older than this.")
        parser.add_argument("--batch", type=int, default=5000, help="Events handled per transaction.")
        parser.add_argument("--dry-run", action="store_true", help="Only say what would happen.")

    def handle(self, *args, **options):
        days = options["days"] if options["days"] is not None else settings.ANALYTICS_RETENTION_DAYS
        if days < 31:
            self.stderr.write("Refusing to keep fewer than 31 days of raw events.")
            return
        now = timezone.now()
        rolled, written = roll_up_events(now - timedelta(days=days), options["batch"], options["dry_run"])
        other = prune_other(now, options["webhook_days"], options["dry_run"])
        prefix = "Would roll up" if options["dry_run"] else "Rolled up"
        into = "" if options["dry_run"] else f" into {written} summary rows"
        self.stdout.write(
            f"{prefix} {rolled} events{into} (kept {days} days of raw events). "
            f"{'Would delete' if options['dry_run'] else 'Deleted'} {other['webhook_deliveries']} webhook deliveries, "
            f"{other['password_resets']} reset rows; {'would clear' if options['dry_run'] else 'cleared'} {other['invite_links']} expired invitation links."
        )
