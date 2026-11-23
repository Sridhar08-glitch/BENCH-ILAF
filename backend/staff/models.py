"""The product team's back office: two-step verification and the staff audit log."""
import uuid

from django.conf import settings
from django.db import models


class StaffTotp(models.Model):
    """The authenticator secret of a staff member. It counts only once `confirmed_at` is set."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="staff_totp")
    secret = models.CharField(max_length=64)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    # The newest time step already accepted, so a code cannot be used twice.
    last_counter = models.BigIntegerField(default=0)
    failed_count = models.PositiveIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class StaffRecoveryCode(models.Model):
    """One of ten single-use recovery codes. Only a hash is stored."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="staff_recovery_codes")
    code_hash = models.CharField(max_length=64, db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class StaffSession(models.Model):
    """A passed second step. The token goes in the X-Staff-Token header; only its hash is stored."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="staff_sessions")
    token_hash = models.CharField(max_length=64, unique=True)
    method = models.CharField(max_length=10, default="totp")
    ip_hash = models.CharField(max_length=32, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    # The newest address the session was used from, so a change of address is logged once.
    last_ip_hash = models.CharField(max_length=32, blank=True)
    # What the Security tab shows: a readable device name ("Chrome on Windows") and the country the session started from.
    device_label = models.CharField(max_length=80, blank=True)
    country = models.CharField(max_length=8, blank=True)


class StaffAuditEvent(models.Model):
    """One thing a staff member did. Rows are only ever added: changing or deleting one raises."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    actor_email = models.CharField(max_length=254, blank=True)
    actor_role = models.CharField(max_length=10, blank=True)
    action = models.CharField(max_length=60, db_index=True)
    target_type = models.CharField(max_length=30, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    target_label = models.CharField(max_length=200, blank=True)
    details = models.JSONField(default=dict, blank=True)
    ip_hash = models.CharField(max_length=32, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Staff audit events cannot be changed.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Staff audit events cannot be deleted.")


from .ops_models import *  # noqa: E402,F401,F403  (the back office's own tables live in ops_models.py)
