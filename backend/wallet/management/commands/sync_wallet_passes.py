"""Send changed cards to the Google Wallet passes people have saved. Run every 5 minutes from cron, for example:

    */5 * * * * cd /path/to/backend && .venv/bin/python manage.py sync_wallet_passes

Only passes whose card changed are sent (an unchanged pass is compared and skipped without calling Google); a failed
send is retried later with growing waits. Running it twice at the same time is safe because deploy/run_job.sh locks it.
"""
from django.core.management.base import BaseCommand

from wallet import sync


class Command(BaseCommand):
    help = "Update the Google Wallet passes whose card has changed."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100, help="Most passes to look at in one run.")
        parser.add_argument("--budget", type=int, default=50, help="Seconds after which the run stops starting new updates.")

    def handle(self, *args, **options):
        stats = sync.process_due(limit=options["limit"], budget_seconds=options["budget"])
        if not stats["configured"]:
            self.stdout.write("Google Wallet updates are off or not set up: nothing to do.")
            return
        self.stdout.write(
            f"Wallet passes: sent {stats['sent']}, unchanged {stats['unchanged']}, not saved by anyone {stats['missing']}, "
            f"failed {stats['failed']}, gave up {stats['gave_up']}" + (", stopped early." if stats["stopped_early"] else ".")
        )
