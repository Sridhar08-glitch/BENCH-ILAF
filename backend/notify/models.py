"""Browser push subscriptions, what a person wants to be told about, and the daily summary log."""
from django.conf import settings
from django.db import models


class PushSubscription(models.Model):
    """One browser that agreed to push notifications. A dead endpoint (the push service answers 404 or 410) is deleted."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions")
    endpoint = models.TextField()
    endpoint_hash = models.CharField(max_length=64, unique=True)
    p256dh = models.CharField(max_length=128)
    auth = models.CharField(max_length=64)
    user_agent = models.CharField(max_length=300, blank=True)
    label = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    failure_count = models.PositiveIntegerField(default=0)


class NotificationPrefs(models.Model):
    """What a person is told about. Push alerts also need a subscribed browser; the daily summary is off until asked for."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_prefs")
    push_leads = models.BooleanField(default=True)
    push_support = models.BooleanField(default=True)
    daily_summary = models.BooleanField(default=False)
    # IANA name such as "Asia/Qatar"; empty means Asia/Qatar. Set from the browser when the summary is switched on.
    timezone = models.CharField(max_length=40, blank=True, default="")
    # The local date of the last summary sent, which makes the daily command safe to run any number of times.
    last_summary_date = models.DateField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
