import uuid

from django.conf import settings
from django.db import models

SCOPES = (
    "cards:read", "cards:write", "leads:read", "leads:write", "team:read", "team:write", "analytics:read",
)

SCOPE_HELP = {
    "cards:read": "Read cards",
    "cards:write": "Create and change cards, publish and unpublish them",
    "leads:read": "Read contacts",
    "leads:write": "Change a contact's status and owner",
    "team:read": "Read the team",
    "team:write": "Invite, suspend and remove employees",
    "analytics:read": "Read the analytics numbers",
}


class ApiKey(models.Model):
    """A company API key. The secret is shown once when it is made and only its SHA-256 hash is stored."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="api_keys")
    name = models.CharField(max_length=80)
    # The first characters of the key, safe to show so people can tell their keys apart.
    prefix = models.CharField(max_length=32, db_index=True)
    key_hash = models.CharField(max_length=64, unique=True)
    scopes = models.JSONField(default=list)
    expires_at = models.DateTimeField(null=True, blank=True)
    # Empty means any address; otherwise a list of addresses or networks (CIDR) the key may be used from.
    allowed_ips = models.JSONField(default=list, blank=True)
    rate_per_minute = models.PositiveIntegerField(default=120)
    rate_per_day = models.PositiveIntegerField(default=5000)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    use_count = models.PositiveBigIntegerField(default=0)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    rotated_from = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="rotated_to")

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["workspace", "-created_at"])]


class IdempotencyRecord(models.Model):
    """What a POST with an Idempotency-Key answered, kept 24 hours so a retry gets the same answer."""

    id = models.BigAutoField(primary_key=True)
    api_key = models.ForeignKey(ApiKey, on_delete=models.CASCADE, related_name="idempotency")
    idem_key = models.CharField(max_length=255)
    request_hash = models.CharField(max_length=64)
    # 0 while the first request is still running.
    status_code = models.PositiveSmallIntegerField(default=0)
    response_body = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["api_key", "idem_key"], name="one_idempotency_key_per_api_key")]
        indexes = [models.Index(fields=["created_at"])]
