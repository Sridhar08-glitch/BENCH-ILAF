from django.core.management.base import BaseCommand

from privacy import services


class Command(BaseCommand):
    help = (
        "Build the export ZIPs that were too big to build while the person waited, and e-mail their links. "
        "Run every few minutes."
    )

    def handle(self, *args, **options):
        self.stdout.write(f"Exports built: {services.process_pending_exports()}")
