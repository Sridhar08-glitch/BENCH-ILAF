"""Send queued leads to the connected CRMs. Run every minute from cron (through deploy/run_job.sh, which holds a lock):

    * * * * * cd /path/to/backend && .venv/bin/python manage.py sync_crm

Running it twice at the same time is safe: each job is claimed before it is sent.
"""
from django.core.management.base import BaseCommand

from crm import sync


class Command(BaseCommand):
    help = "Send the leads that are due to the connected CRMs and retry the ones that failed."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=200, help="Most jobs to send in one run.")
        parser.add_argument("--prune-days", type=int, default=90, help="Forget finished jobs older than this.")

    def handle(self, *args, **options):
        stats = sync.process_queue(limit=options["limit"])
        removed = sync.prune(options["prune_days"])
        self.stdout.write(
            f"Sent {stats['sent']}, failed {stats['failed']}, will retry {stats['retry']}, skipped {stats['skipped']}, "
            f"removed {removed} old rows."
        )
