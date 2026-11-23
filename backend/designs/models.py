"""Custom card designs: a company asks for a bespoke face, staff build it, the company approves and uses it privately."""
import secrets
import uuid

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import models
from django.utils.deconstruct import deconstructible


@deconstructible
class PrivateStorage(FileSystemStorage):
    """Request files live outside the public media folder and are served only through authenticated endpoints."""

    @property
    def base_location(self):
        return str(settings.PRIVATE_FILES_ROOT)

    @property
    def location(self):
        from pathlib import Path

        return str(Path(self.base_location).resolve())

    @property
    def base_url(self):
        return None


def private_name(instance, filename):
    return f"design-requests/{instance.request_id}/{secrets.token_hex(16)}"


class CustomFace(models.Model):
    """A card face made for one company. Only that company can use it (see designs.services.usable_face)."""

    STATUSES = [(s, s) for s in ("draft", "in_review", "approved", "live", "disabled")]
    KINDS = [("face", "face")]  # below layouts and openings can follow: they get their own kind

    id = models.AutoField(primary_key=True)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="custom_faces")
    kind = models.CharField(max_length=10, choices=KINDS, default="face")
    name = models.CharField(max_length=80)
    status = models.CharField(max_length=10, choices=STATUSES, default="draft", db_index=True)
    source_request = models.ForeignKey(
        "designs.DesignRequest", null=True, blank=True, on_delete=models.SET_NULL, related_name="faces"
    )
    tags = models.JSONField(default=list, blank=True)
    # Exactly four colourways, each {name, bg, bg2, fg, acc, on}.
    palettes = models.JSONField(default=list, blank=True)
    template = models.TextField(blank=True, default="")
    css = models.TextField(blank=True, default="")
    # What the sanitiser removed the last time the face was saved.
    warnings = models.JSONField(default=list, blank=True)
    # When true the face keeps its own fonts and ignores the font a card owner picks.
    font_locked = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    published_at = models.DateTimeField(null=True, blank=True)
    disabled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        indexes = [models.Index(fields=["workspace", "status"])]

    def __str__(self):
        return f"{self.name} ({self.pk})"


class CustomFaceVersion(models.Model):
    """A saved snapshot of a face, so staff can go back to an earlier state."""

    face = models.ForeignKey(CustomFace, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField()
    name = models.CharField(max_length=80)
    note = models.CharField(max_length=200, blank=True)
    template = models.TextField(blank=True, default="")
    css = models.TextField(blank=True, default="")
    palettes = models.JSONField(default=list, blank=True)
    tags = models.JSONField(default=list, blank=True)
    font_locked = models.BooleanField(default=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-number"]
        constraints = [models.UniqueConstraint(fields=["face", "number"], name="one_version_number_per_face")]


class DesignRequest(models.Model):
    """A company's request for a bespoke card design."""

    STATUSES = [
        (s, s) for s in (
            "new", "contacted", "in_design", "in_review", "changes_requested", "approved", "live", "closed", "withdrawn",
        )
    ]
    # A company has at most one request in these states; it may start another once this one is finished.
    OPEN = ("new", "contacted", "in_design", "in_review", "changes_requested", "approved")
    LANGUAGES = [("en", "en"), ("ar", "ar"), ("both", "both")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="design_requests")
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    requested_by_email = models.CharField(max_length=254, blank=True)
    status = models.CharField(max_length=20, choices=STATUSES, default="new", db_index=True)
    goals = models.TextField(blank=True, default="")
    brand_assets_notes = models.TextField(blank=True, default="")
    style_examples = models.JSONField(default=list, blank=True)
    languages = models.CharField(max_length=4, choices=LANGUAGES, default="en")
    deadline = models.DateField(null=True, blank=True)
    employees_count = models.PositiveIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    # The owner allows staff to show real names and titles of the team in preview links.
    allow_team_names = models.BooleanField(default=False)
    # A request to change a face that is already live points at that face.
    follows_face = models.ForeignKey(CustomFace, null=True, blank=True, on_delete=models.SET_NULL, related_name="follow_ups")
    assigned_staff = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_design_requests")
    customer_seen_at = models.DateTimeField(null=True, blank=True)
    last_message_at = models.DateTimeField(null=True, blank=True)
    last_author_kind = models.CharField(max_length=10, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["workspace", "status"])]


class DesignRequestMessage(models.Model):
    """One entry of the thread: a message from the company or from staff, or a note about a status change."""

    AUTHORS = [("customer", "customer"), ("staff", "staff"), ("system", "system")]
    KINDS = [("message", "message"), ("status", "status")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request = models.ForeignKey(DesignRequest, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    author_kind = models.CharField(max_length=10, choices=AUTHORS)
    author_name = models.CharField(max_length=120, blank=True)
    kind = models.CharField(max_length=10, choices=KINDS, default="message")
    body = models.TextField(blank=True, default="")
    # Staff-only notes are never sent to the company.
    internal = models.BooleanField(default=False)
    status_to = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]


class DesignRequestFile(models.Model):
    """An uploaded picture or PDF. The stored name is random; the original name is kept for display only."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request = models.ForeignKey(DesignRequest, on_delete=models.CASCADE, related_name="files")
    message = models.ForeignKey(DesignRequestMessage, null=True, blank=True, on_delete=models.SET_NULL, related_name="files")
    uploaded_by_kind = models.CharField(max_length=10, default="customer")
    original_name = models.CharField(max_length=120)
    content_type = models.CharField(max_length=30)
    size = models.PositiveIntegerField()
    file = models.FileField(upload_to=private_name, storage=PrivateStorage(), max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class CustomFacePreview(models.Model):
    """A private link that shows a face on sample employees without signing in. Only the token's hash is stored."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    face = models.ForeignKey(CustomFace, on_delete=models.CASCADE, related_name="previews")
    token_hash = models.CharField(max_length=64, unique=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    view_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
