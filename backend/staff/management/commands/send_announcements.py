from django.core.management.base import BaseCommand

from staff import announce


class Command(BaseCommand):
    help = "Send announcement e-mails that are due, a batch at a time. Run every 5 minutes; a repeated run sends nothing twice."

    def handle(self, *args, **options):
        self.stdout.write(f"Announcement e-mails sent: {announce.run_broadcasts()}")
