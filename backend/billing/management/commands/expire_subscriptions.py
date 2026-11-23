from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from billing.models import Subscription


class Command(BaseCommand):
    help = "Mark subscriptions as expired once their end plus the grace days has passed. Run daily."

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=settings.CARDS_GRACE_DAYS)
        count = Subscription.objects.filter(status="active", ends_at__lt=cutoff).update(status="expired")
        self.stdout.write(f"Expired subscriptions: {count}")
