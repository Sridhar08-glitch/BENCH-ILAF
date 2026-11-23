"""Housekeeping for signed-in devices, remembered browsers, security events, push subscriptions and domain claims. Run daily."""
from django.core.management.base import BaseCommand
from django.utils import timezone

from notify import services as notify_services
from security import services
from security.models import VerifiedDomain


class Command(BaseCommand):
    help = "Delete old sessions, expired remembered browsers, dead push subscriptions and expired domain claims."

    def handle(self, *args, **options):
        gone = services.prune()
        pushes = notify_services.prune_subscriptions()
        expired = VerifiedDomain.objects.filter(status="pending", expires_at__lt=timezone.now()).update(status="expired")
        self.stdout.write(f"Deleted {gone} device rows, {pushes} push subscriptions; {expired} domain claims expired.")
