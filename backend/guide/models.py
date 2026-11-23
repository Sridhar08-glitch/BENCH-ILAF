"""Per-person progress through the in-app guides.

One row says what a person did with one guide step (or one remembered prompt): finished it by hand,
skipped it, dismissed it, or gave a thumb on a help article. Whether a step is *really* done is always
derived from live data in the web app; these rows only hold what the data cannot show.
"""
import uuid

from django.conf import settings
from django.db import models

STATES = [
    ("done", "done"),
    ("skipped", "skipped"),
    ("dismissed", "dismissed"),
    ("shown", "shown"),
    ("up", "up"),
    ("down", "down"),
]


class GuideProgress(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="guide_progress")
    # A guide id ("personal", "company_owner", ...) or a prompt family ("welcome", "next", "help", "tour").
    guide_id = models.CharField(max_length=64)
    # A step id, an event name or an article slug.
    step_id = models.CharField(max_length=64)
    state = models.CharField(max_length=10, choices=STATES)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "guide_id", "step_id"], name="guide_progress_unique")]
        ordering = ["guide_id", "step_id"]

    def __str__(self):
        return f"{self.user_id} {self.guide_id}/{self.step_id}: {self.state}"
