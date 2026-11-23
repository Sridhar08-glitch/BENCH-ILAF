from django.db import models
from django.db.models import IntegerField, Sum, Value
from django.db.models.functions import Coalesce

from cards.models import Card


def event_count(condition=None):
    """How many visitor actions: the sum of `weight` (an ordinary event counts 1, a rolled-up row counts what it stands
    for). Use this instead of Count("id") on events, so counts survive pruning of old rows."""
    return Coalesce(Sum("weight", filter=condition), Value(0), output_field=IntegerField())


class Event(models.Model):
    """One visitor action on a public card. No IP address is kept, only a daily anonymous hash."""

    TYPES = [("view", "view"), ("tap", "tap"), ("save", "save"), ("link_click", "link_click")]

    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="events")
    type = models.CharField(max_length=12, choices=TYPES)
    source = models.CharField(max_length=10, default="link")
    kind = models.CharField(max_length=20, blank=True)  # which button, for link clicks
    country = models.CharField(max_length=10, default="unknown")
    device = models.CharField(max_length=10, default="other")
    visitor_hash = models.CharField(max_length=32, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Old events are rolled up by `prune_analytics`: many events with the same card, type, source, button, country
    # and device inside the same quarter of an hour become one row (rolled=True, no visitor hash) whose weight is the
    # number of events it stands for. Every count adds up the weights.
    weight = models.PositiveIntegerField(default=1)
    rolled = models.BooleanField(default=False)

    class Meta:
        indexes = [
            models.Index(fields=["card", "type", "created_at"]),
            models.Index(fields=["card", "created_at"]),
            models.Index(fields=["rolled", "created_at"]),
        ]


class ReportPreference(models.Model):
    """Whether a person gets the weekly report e-mails for one workspace. No row means both are on."""

    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="+")
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="+")
    personal_report = models.BooleanField(default=True)
    company_report = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "workspace"], name="one_report_preference")]


class WeeklyReportLog(models.Model):
    """One report sent to one person for one ISO week. The unique key is what makes the weekly command safe to run twice."""

    KINDS = [("personal", "personal"), ("company", "company")]

    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="+")
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=10, choices=KINDS)
    iso_year = models.PositiveIntegerField()
    iso_week = models.PositiveIntegerField()
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "workspace", "kind", "iso_year", "iso_week"], name="one_report_per_week")
        ]
