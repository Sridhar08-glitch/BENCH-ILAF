"""Data requests: one row for every export or deletion a person (or company owner) asks for.

The table is the record that the admin dashboard and a data-protection officer read: what was asked,
when, the date it is due (30 days), whether it is done and who handled it.
"""
import uuid

from django.conf import settings
from django.db import models


class DataRequest(models.Model):
    KINDS = [("export", "export"), ("delete", "delete")]
    SCOPES = [("user", "user"), ("workspace", "workspace")]
    # export: pending -> processing -> ready -> completed (downloaded) | expired | failed
    # delete: pending (grace period) -> completed (erased) | cancelled (restored)
    STATUSES = [
        ("pending", "pending"), ("processing", "processing"), ("ready", "ready"), ("completed", "completed"),
        ("cancelled", "cancelled"), ("expired", "expired"), ("failed", "failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=10, choices=KINDS, db_index=True)
    scope = models.CharField(max_length=10, choices=SCOPES, default="user")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="data_requests")
    workspace = models.ForeignKey(
        "workspaces.Workspace", null=True, blank=True, on_delete=models.SET_NULL, related_name="data_requests"
    )
    status = models.CharField(max_length=12, choices=STATUSES, default="pending", db_index=True)
    requested_at = models.DateTimeField(auto_now_add=True)
    # The legal deadline for answering the request (requested_at + DATA_REQUEST_DUE_DAYS).
    due_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)
    # Staff member who dealt with it by hand, when someone did.
    handled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Deletion: when the grace period ends and the data is erased.
    scheduled_for = models.DateTimeField(null=True, blank=True)
    # Export: the ZIP in private storage, and the one-time link's limits.
    file_name = models.CharField(max_length=200, blank=True)
    file_size = models.PositiveBigIntegerField(default=0)
    ready_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    downloaded_at = models.DateTimeField(null=True, blank=True)
    # Cards that were published when a deletion started, so a restore can publish them again.
    details = models.JSONField(default=dict, blank=True)
    error = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["-requested_at"]
        indexes = [models.Index(fields=["user", "kind", "-requested_at"])]

    def __str__(self):
        return f"{self.kind} {self.scope} {self.status} ({self.id})"
