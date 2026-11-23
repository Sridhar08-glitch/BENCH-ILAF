import uuid

from django.conf import settings
from django.db import models

from ilaf.design import default_design, default_vc

from .features import default_features
from workspaces.models import Member, Workspace


class Card(models.Model):
    STATUSES = [("draft", "draft"), ("published", "published"), ("suspended", "suspended")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="cards")
    # The login account that owns the card, and the team seat it belongs to. The seat link is
    # what grants an employee access; it is cleared when the member is removed.
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="cards"
    )
    member = models.ForeignKey(Member, null=True, blank=True, on_delete=models.SET_NULL, related_name="cards")
    # Random and permanent: printed on QR codes and NFC tags, so it must never change.
    public_code = models.CharField(max_length=10, unique=True, editable=False)
    slug = models.SlugField(max_length=40, unique=True, null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUSES, default="draft")
    # Status to return to when a suspended card is restored.
    status_before_suspend = models.CharField(max_length=10, blank=True, default="draft")
    # True when the product team suspended the card: the company cannot restore it itself.
    staff_hold = models.BooleanField(default=False)
    # A private name for the owner's own list ("Work", "Personal", "Side project"); never shown on the public page.
    label = models.CharField(max_length=40, blank=True, default="")
    # The order of a person's cards in their list, and the card that "My QR" and event mode use first.
    sort_order = models.PositiveIntegerField(default=0)
    is_default = models.BooleanField(default=False)
    name = models.CharField(max_length=120, blank=True)
    title = models.CharField(max_length=120, blank=True)
    company = models.CharField(max_length=120, blank=True)
    address = models.CharField(max_length=300, blank=True)
    photo = models.ImageField(upload_to="cards/", blank=True, null=True)
    cover = models.ImageField(upload_to="covers/", blank=True, null=True)
    save_contact = models.BooleanField(default=True)
    # Language and direction of the public page: "en", "ar", or "auto" (the visitor's own language).
    language = models.CharField(max_length=5, default="auto")
    # Keeps the card out of the public company directory (the card itself stays live).
    hide_from_directory = models.BooleanField(default=False)
    # Search engines may index the public card page only when the owner turns this on; off means a noindex tag.
    seo_indexable = models.BooleanField(default=False)
    vc = models.JSONField(default=default_vc)
    design = models.JSONField(default=default_design)
    # Feature settings such as the exchange-contact form (see cards.features).
    features = models.JSONField(default=default_features)
    # The old layout-based design, kept after the design model changed so nothing is lost.
    legacy_design = models.JSONField(null=True, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "created_at"]
        indexes = [models.Index(fields=["workspace", "created_at"])]

    def __str__(self):
        return f"{self.name or 'Card'} ({self.public_code})"


class CardItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="items")
    kind = models.CharField(max_length=20)
    value = models.CharField(max_length=500, blank=True)
    label = models.CharField(max_length=40, blank=True)
    on = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)
    icon = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["order", "id"]


class SlugHistory(models.Model):
    """Old slugs of a card. They keep working and point at the card's current address."""

    slug = models.SlugField(max_length=40, unique=True)
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="old_slugs")
    created_at = models.DateTimeField(auto_now_add=True)
