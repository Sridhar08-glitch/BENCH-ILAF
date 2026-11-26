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
    # The company's own card: it belongs to the company, not to a person. Only owners and admins reach it, and its shop, bookings and
    # other extras are the company's. At most one per company.
    is_company = models.BooleanField(default=False)
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
    # A short introduction shown by the photo headers (page styles); guarded by the company's address rule.
    bio = models.TextField(blank=True, default="")
    photo = models.ImageField(upload_to="cards/", blank=True, null=True)
    cover = models.ImageField(upload_to="covers/", blank=True, null=True)
    # An uploaded MP4 played by the video section, with an optional still shown before it plays.
    video = models.FileField(upload_to="videos/", blank=True, null=True)
    video_poster = models.ImageField(upload_to="videos/", blank=True, null=True)
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
        constraints = [
            models.UniqueConstraint(fields=["workspace"], condition=models.Q(is_company=True), name="one_company_card_per_workspace"),
        ]

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


class CardSection(models.Model):
    """A rich block drawn under the card: video, products, hours, booking, team, gallery, event or map.

    `data` is the block's settings, checked per kind in cards.sections. Switched-off blocks stay saved but are
    left out of the public page."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="sections")
    kind = models.CharField(max_length=20)
    order = models.PositiveIntegerField(default=0)
    on = models.BooleanField(default=True)
    data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "created_at"]

    def __str__(self):
        return f"{self.kind} on {self.card_id}"


class CardGalleryImage(models.Model):
    """One picture of a card's gallery section (up to nine per card)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="gallery_images")
    image = models.ImageField(upload_to="gallery/")
    caption = models.CharField(max_length=80, blank=True, default="")
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "created_at"]


# Selling and booking models live in their own file and are part of this app.
try:
    from .models_commerce import *  # noqa: E402,F401,F403
except ImportError:  # pragma: no cover - the file ships with the app
    pass
