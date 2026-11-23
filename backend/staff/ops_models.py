"""The back office's own tables: request metrics, recent errors, the e-mail log, company notes, support-view sessions,
abuse reports, applications (company leads), feature switches and announcements. Imported by staff/models.py."""
import uuid

from django.conf import settings
from django.db import models

__all__ = [
    "RequestMetric", "ErrorLogEntry", "EmailLog", "CompanyNote", "SupportViewSession", "AbuseReport", "CompanyLead",
    "FeatureFlag", "FeatureFlagChange", "Announcement", "AnnouncementDismissal", "AnnouncementDelivery",
]


class RequestMetric(models.Model):
    """Counts of API requests in one minute: how many, how many failed on the server, and a speed histogram."""

    minute = models.DateTimeField(unique=True)
    requests = models.PositiveIntegerField(default=0)
    server_errors = models.PositiveIntegerField(default=0)
    # Upper bound in milliseconds -> number of requests that took up to that long (the last bucket is "slower").
    buckets = models.JSONField(default=dict)


class ErrorLogEntry(models.Model):
    """One server error, with personal details removed. Only the newest rows are kept."""

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    source = models.CharField(max_length=60, blank=True)
    path = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=10, blank=True)
    message = models.CharField(max_length=300)
    trace_hash = models.CharField(max_length=16, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class EmailLog(models.Model):
    """One e-mail the product tried to send. No bodies are kept, except that of a failed one (so it can be resent)."""

    KINDS = [("transactional", "transactional"), ("marketing", "marketing"), ("staff", "staff")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    to_email = models.CharField(max_length=254)
    subject = models.CharField(max_length=200)
    kind = models.CharField(max_length=14, choices=KINDS, default="transactional")
    status = models.CharField(max_length=10, default="sent", db_index=True)  # sent | failed | resent
    error = models.CharField(max_length=200, blank=True)
    retry_text = models.TextField(blank=True)
    retry_html = models.TextField(blank=True)
    retry_headers = models.JSONField(default=dict, blank=True)
    resent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]


class CompanyNote(models.Model):
    """An internal note about a company. Customers never see these."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="staff_notes")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    author_email = models.CharField(max_length=254, blank=True)
    body = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class SupportViewSession(models.Model):
    """A read-only look at a company's account. It lasts 30 minutes, needs a reason, and the customer sees it."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    staff = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    staff_email = models.CharField(max_length=254)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="support_views")
    reason = models.CharField(max_length=300)
    started_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    ended_how = models.CharField(max_length=10, blank=True)  # manual | expired | replaced | role
    # What was opened, page by page: [{"t": iso time, "page": "leads"}]
    pages = models.JSONField(default=list, blank=True)
    ip_hash = models.CharField(max_length=32, blank=True)

    class Meta:
        ordering = ["-started_at"]


class AbuseReport(models.Model):
    """A visitor's report about a public card."""

    REASONS = [("spam", "spam"), ("fake", "fake"), ("offensive", "offensive"), ("impersonation", "impersonation"), ("other", "other")]
    STATUSES = [("new", "new"), ("reviewing", "reviewing"), ("actioned", "actioned"), ("dismissed", "dismissed")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey("cards.Card", null=True, on_delete=models.SET_NULL, related_name="abuse_reports")
    workspace = models.ForeignKey("workspaces.Workspace", null=True, on_delete=models.SET_NULL, related_name="abuse_reports")
    card_name = models.CharField(max_length=120, blank=True)
    reason = models.CharField(max_length=14, choices=REASONS)
    note = models.CharField(max_length=500, blank=True)
    reporter_email = models.CharField(max_length=254, blank=True)
    reporter_hash = models.CharField(max_length=32, blank=True, db_index=True)
    status = models.CharField(max_length=10, choices=STATUSES, default="new", db_index=True)
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    due_at = models.DateTimeField()
    resolved_at = models.DateTimeField(null=True, blank=True)
    outcome = models.CharField(max_length=20, blank=True)
    # Notes and decisions: [{"t": iso time, "who": email, "kind": "note|status|warn|suspend_card|suspend_company", "text": str}]
    history = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at"]


class CompanyLead(models.Model):
    """A company that asked to talk to the product team (the public "request access" form)."""

    STATUSES = [("new", "new"), ("contacted", "contacted"), ("qualified", "qualified"), ("won", "won"), ("lost", "lost")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.CharField(max_length=120)
    name = models.CharField(max_length=120)
    email = models.CharField(max_length=254)
    size = models.CharField(max_length=20, blank=True)
    message = models.CharField(max_length=1000, blank=True)
    source = models.CharField(max_length=30, blank=True, default="website")
    language = models.CharField(max_length=5, blank=True, default="")
    status = models.CharField(max_length=10, choices=STATUSES, default="new", db_index=True)
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    notes = models.JSONField(default=list, blank=True)  # [{"t": iso time, "who": email, "text": str}]
    reporter_hash = models.CharField(max_length=32, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]


class FeatureFlag(models.Model):
    """A feature switch: off, on for the chosen companies, or on for everyone (optionally a percentage of companies)."""

    STATES = [("off", "off"), ("selected", "selected"), ("everyone", "everyone")]

    key = models.SlugField(primary_key=True, max_length=40)
    description = models.CharField(max_length=200, blank=True)
    state = models.CharField(max_length=10, choices=STATES, default="everyone")
    rollout_percent = models.PositiveSmallIntegerField(default=100)
    company_ids = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class FeatureFlagChange(models.Model):
    flag = models.ForeignKey(FeatureFlag, on_delete=models.CASCADE, related_name="changes")
    actor_email = models.CharField(max_length=254, blank=True)
    summary = models.CharField(max_length=300)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class Announcement(models.Model):
    """A banner in the customer app and/or an e-mail broadcast. English and Arabic texts are both required."""

    SEVERITIES = [("info", "info"), ("warning", "warning"), ("critical", "critical")]
    AUDIENCES = [("all", "all"), ("plan", "plan"), ("country", "country"), ("companies", "companies")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title_en = models.CharField(max_length=120)
    title_ar = models.CharField(max_length=120)
    body_en = models.CharField(max_length=600)
    body_ar = models.CharField(max_length=600)
    severity = models.CharField(max_length=10, choices=SEVERITIES, default="info")
    audience_kind = models.CharField(max_length=10, choices=AUDIENCES, default="all")
    audience_values = models.JSONField(default=list, blank=True)
    banner = models.BooleanField(default=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    send_email = models.BooleanField(default=False)
    # Product updates are marketing: only people who agreed to them get the e-mail. A notice about the service itself
    # (maintenance, a security matter) is transactional and goes to every account owner and admin of the audience.
    email_kind = models.CharField(max_length=14, default="marketing")
    email_send_at = models.DateTimeField(null=True, blank=True)
    email_status = models.CharField(max_length=10, default="none")  # none | scheduled | sending | sent
    email_sent_count = models.PositiveIntegerField(default=0)
    email_finished_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class AnnouncementDismissal(models.Model):
    announcement = models.ForeignKey(Announcement, on_delete=models.CASCADE, related_name="dismissals")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("announcement", "user")]


class AnnouncementDelivery(models.Model):
    """One e-mail of a broadcast to one person. The unique pair makes a repeated run send nothing twice."""

    announcement = models.ForeignKey(Announcement, on_delete=models.CASCADE, related_name="deliveries")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    ok = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("announcement", "user")]
