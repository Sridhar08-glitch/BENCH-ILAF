"""Forget idempotency records older than 24 hours. Run daily from cron."""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from publicapi.models import IdempotencyRecord


class Command(BaseCommand):
    help = "Delete idempotency records older than 24 hours."

    def handle(self, *args, **options):
        removed, _ = IdempotencyRecord.objects.filter(created_at__lt=timezone.now() - timedelta(hours=24)).delete()
        self.stdout.write(f"Removed {removed} old idempotency records.")
