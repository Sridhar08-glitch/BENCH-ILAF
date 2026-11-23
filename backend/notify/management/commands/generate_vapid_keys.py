"""Print a new VAPID key pair for browser push notifications (put the three lines in the server's .env file)."""
from django.core.management.base import BaseCommand

from notify import webpush


class Command(BaseCommand):
    help = "Generate a VAPID key pair."

    def handle(self, *args, **options):
        private, public = webpush.generate_vapid_keys()
        self.stdout.write(f"VAPID_PUBLIC_KEY={public}")
        self.stdout.write(f"VAPID_PRIVATE_KEY={private}")
        self.stdout.write("VAPID_SUBJECT=mailto:support@your-domain.example")
