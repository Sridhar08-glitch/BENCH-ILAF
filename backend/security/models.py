"""Account security: two-step verification, signed-in devices, company security policy and verified company domains."""
import uuid

from django.conf import settings
from django.db import models


class UserTotp(models.Model):
    """The authenticator secret of a person. It counts only once `confirmed_at` is set."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="mfa_totp")
    secret = models.CharField(max_length=64)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    # The newest time step already accepted, so a code cannot be used twice.
    last_counter = models.BigIntegerField(default=0)
    failed_count = models.PositiveIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class RecoveryCode(models.Model):
    """One of ten single-use recovery codes. Only a hash is stored."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="mfa_recovery_codes")
    code_hash = models.CharField(max_length=64, db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class Session(models.Model):
    """A signed-in device: one row per sign-in. `id` rides inside the refresh and access tokens (claim `sid`) and
    survives token rotation; `refresh_jti` follows the newest refresh token so the session can be revoked."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="login_sessions")
    refresh_jti = models.CharField(max_length=64, blank=True, db_index=True)
    label = models.CharField(max_length=80, blank=True)
    device_kind = models.CharField(max_length=10, blank=True)
    fingerprint = models.CharField(max_length=64, blank=True)
    ip_masked = models.CharField(max_length=64, blank=True)
    country = models.CharField(max_length=2, blank=True)
    method = models.CharField(max_length=12, default="password")
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-last_used_at"]


class KnownDevice(models.Model):
    """A device fingerprint seen for this person; a sign-in from one that is not here yet triggers the new-device e-mail."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="known_devices")
    fingerprint = models.CharField(max_length=64)
    label = models.CharField(max_length=80, blank=True)
    first_seen_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "fingerprint"], name="one_known_device_per_fingerprint")]


class TrustedDevice(models.Model):
    """"Remember this device": the browser keeps a random token, only its hash is stored here. For 30 days a
    sign-in from it skips the second step."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trusted_devices")
    token_hash = models.CharField(max_length=64, unique=True)
    label = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ["-last_used_at"]


class SecurityEvent(models.Model):
    """A short account-level security log the person can read (two-step verification on or off, new devices)."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="security_events")
    action = models.CharField(max_length=40, db_index=True)
    detail = models.CharField(max_length=200, blank=True)
    ip_masked = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class WorkspacePolicy(models.Model):
    """Company settings that sit next to the workspace: the two-step verification rule and the reply-to address of
    the company's e-mails."""

    workspace = models.OneToOneField("workspaces.Workspace", on_delete=models.CASCADE, related_name="policy")
    require_2fa = models.BooleanField(default=False)
    # When the owner switched the rule on; members have a grace period counted from here (or from their joining).
    require_2fa_since = models.DateTimeField(null=True, blank=True)
    reply_to_email = models.EmailField(blank=True, default="")


class VerifiedDomain(models.Model):
    """A company's proof that it owns an e-mail domain: a link or code sent to a mailbox at that domain."""

    STATUSES = [("pending", "pending"), ("verified", "verified"), ("expired", "expired")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="verified_domains")
    domain = models.CharField(max_length=253)
    method = models.CharField(max_length=10, default="email")
    status = models.CharField(max_length=10, choices=STATUSES, default="pending")
    token_hash = models.CharField(max_length=64, blank=True, db_index=True)
    code_hash = models.CharField(max_length=64, blank=True)
    sent_to = models.EmailField(blank=True)
    attempts = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "domain"], name="one_domain_claim_per_workspace"),
            models.UniqueConstraint(
                fields=["domain"], condition=models.Q(status="verified"), name="one_verified_owner_per_domain"
            ),
        ]
        ordering = ["domain"]
