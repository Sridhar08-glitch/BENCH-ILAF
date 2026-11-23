"""Company operations: the audit log, departments with card templates, and change requests."""
import uuid

from django.conf import settings
from django.db import models


class AuditEvent(models.Model):
    """One thing an admin (or an employee asking for a change) did in a company workspace.

    Rows are only ever added: saving an existing row or deleting one through the model raises."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="audit_events")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    actor_email = models.CharField(max_length=254, blank=True)
    actor_name = models.CharField(max_length=120, blank=True)
    action = models.CharField(max_length=60, db_index=True)
    target_type = models.CharField(max_length=30, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    target_label = models.CharField(max_length=200, blank=True)
    details = models.JSONField(default=dict, blank=True)
    ip_hash = models.CharField(max_length=32, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["workspace", "-created_at"])]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Audit events cannot be changed.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Audit events cannot be deleted.")


class Department(models.Model):
    """A group of people (Sales, Support). Its template starts the draft card of every new member in it."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="departments")
    name = models.CharField(max_length=60)
    # Partial design: any of face, colour, below, intro. Empty means the company design.
    design = models.JSONField(default=dict, blank=True)
    # Buttons the draft card starts with, and buttons every card in the department must keep.
    items = models.JSONField(default=list, blank=True)
    mandatory_items = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["workspace", "name"], name="one_department_name_per_workspace")]

    def __str__(self):
        return f"{self.name} ({self.workspace_id})"


class ChangeRequest(models.Model):
    """A change an employee asked for on a field that needs approval. The card keeps its old value until decided."""

    STATUSES = [
        ("pending", "pending"), ("approved", "approved"), ("rejected", "rejected"),
        ("withdrawn", "withdrawn"), ("superseded", "superseded"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="change_requests")
    card = models.ForeignKey("cards.Card", on_delete=models.CASCADE, related_name="change_requests")
    field = models.CharField(max_length=20)
    old_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=STATUSES, default="pending", db_index=True)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    reason = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["workspace", "status", "-created_at"])]
