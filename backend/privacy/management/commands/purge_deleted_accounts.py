from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import User
from privacy import services
from workspaces.models import Workspace


class Command(BaseCommand):
    help = "Erase accounts and companies whose 14 day deletion grace period is over. Run daily."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Only count what would be erased.")

    def handle(self, *args, **options):
        now = timezone.now()
        if options["dry_run"]:
            ws = Workspace.objects.filter(kind="company", deletion_due_at__lte=now, deleted_at__isnull=True).count()
            users = User.objects.filter(deletion_due_at__lte=now, deleted_at__isnull=True).count()
            self.stdout.write(f"Would erase {ws} companies and {users} accounts.")
            return
        workspaces, users = services.purge_due(now)
        self.stdout.write(f"Erased {workspaces} companies and {users} accounts.")
