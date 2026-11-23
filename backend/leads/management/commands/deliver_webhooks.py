"""Send queued webhook events. Run every minute from cron, for example:

    * * * * * cd /path/to/backend && .venv/bin/python manage.py deliver_webhooks

Running it twice at the same time is safe: each delivery is claimed before it is sent.
"""
from django.core.management.base import BaseCommand

from leads import webhooks


class Command(BaseCommand):
    help = "Send the webhook events that are due and retry the ones that failed."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=200, help="Most deliveries to send in one run.")
        parser.add_argument("--prune-days", type=int, default=90, help="Forget finished deliveries older than this.")

    def handle(self, *args, **options):
        stats = webhooks.process_queue(limit=options["limit"])
        removed = webhooks.prune(options["prune_days"])
        self.stdout.write(
            f"Sent {stats['sent']}, failed {stats['failed']}, skipped {stats['skipped']}, removed {removed} old rows."
        )
