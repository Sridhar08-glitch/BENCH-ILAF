import uuid

from django.conf import settings
from django.db import models

VENDORS = ("hubspot", "salesforce", "zoho")


def default_settings():
    return {
        "sync_new_leads": True,
        "add_note": True,
        "assign_owner": False,
        "sync_status": False,
        "status_map": {},
    }


class CrmConnection(models.Model):
    """One company's link to one CRM. Tokens are stored encrypted (see crm/crypto.py)."""

    STATUSES = [("connected", "connected"), ("disabled", "disabled")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="crm_connections")
    vendor = models.CharField(max_length=12)
    # Zoho only: the data centre (com, eu, in).
    region = models.CharField(max_length=8, blank=True)
    # Salesforce: the org's address; Zoho: the API address. Both come from the vendor's token answer and are checked
    # against the vendor's own domains before they are saved.
    instance_url = models.CharField(max_length=200, blank=True)
    account_label = models.CharField(max_length=200, blank=True)
    access_token = models.TextField(blank=True)
    refresh_token = models.TextField(blank=True)
    token_expires_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=STATUSES, default="connected")
    # Why a disabled connection stopped (shown in the settings page as a code the page translates).
    disabled_reason = models.CharField(max_length=40, blank=True)
    field_mapping = models.JSONField(default=dict, blank=True)
    options = models.JSONField(default=default_settings, blank=True)
    connected_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    connected_at = models.DateTimeField(auto_now_add=True)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=300, blank=True)
    last_error_code = models.CharField(max_length=40, blank=True)
    last_error_at = models.DateTimeField(null=True, blank=True)
    consecutive_failures = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["workspace", "vendor"], name="one_crm_connection_per_vendor")]


class CrmLeadLink(models.Model):
    """Which CRM record a lead became, so a later change updates it instead of making a second one."""

    id = models.BigAutoField(primary_key=True)
    connection = models.ForeignKey(CrmConnection, on_delete=models.CASCADE, related_name="links")
    lead_id = models.UUIDField()
    remote_id = models.CharField(max_length=80)
    remote_type = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["connection", "lead_id"], name="one_crm_link_per_lead")]


class CrmSyncJob(models.Model):
    """One thing to send to a CRM. The command `sync_crm` works through the queue."""

    KINDS = [("upsert", "upsert"), ("status", "status"), ("test", "test")]
    STATUSES = [("pending", "pending"), ("success", "success"), ("failed", "failed")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    connection = models.ForeignKey(CrmConnection, on_delete=models.CASCADE, related_name="jobs")
    kind = models.CharField(max_length=10, choices=KINDS)
    lead_id = models.UUIDField(null=True, blank=True)
    # A snapshot of the lead at the time (see leads.webhooks.lead_payload); the field mapping is applied when sending.
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=10, choices=STATUSES, default="pending")
    attempts = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField(null=True, blank=True)
    locked_until = models.DateTimeField(null=True, blank=True)
    remote_id = models.CharField(max_length=80, blank=True)
    action = models.CharField(max_length=12, blank=True)  # created or updated
    error = models.CharField(max_length=300, blank=True)
    error_code = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "next_attempt_at"]),
            models.Index(fields=["connection", "-created_at"]),
        ]
