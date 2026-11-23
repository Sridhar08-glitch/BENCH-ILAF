from django.core.management.base import BaseCommand

from privacy import services


class Command(BaseCommand):
    help = "Delete export files that were downloaded or whose 24 hour link has expired. Run hourly."

    def handle(self, *args, **options):
        self.stdout.write(f"Export files deleted: {services.cleanup_exports()}")
