"""Selling and booking inside a card: products a visitor can order, the owner's booking hours and the bookings taken.

These models are loaded from the end of cards/models.py so they live in the `cards` app next to Card. Orders
themselves live in the `orders` app.
"""
import uuid

from django.db import models

# ISO 4217 currency of a workspace country, for the default currency of a new product. QAR when the country is unknown.
COUNTRY_CURRENCIES = {
    "QA": "QAR", "AE": "AED", "SA": "SAR", "KW": "KWD", "BH": "BHD", "OM": "OMR", "EG": "EGP", "JO": "JOD",
    "LB": "LBP", "IQ": "IQD", "MA": "MAD", "TN": "TND", "DZ": "DZD", "TR": "TRY", "IN": "INR", "PK": "PKR",
    "GB": "GBP", "US": "USD", "CA": "CAD", "AU": "AUD", "CH": "CHF", "SE": "SEK", "NO": "NOK", "DK": "DKK",
    "DE": "EUR", "FR": "EUR", "ES": "EUR", "IT": "EUR", "NL": "EUR", "BE": "EUR", "AT": "EUR", "IE": "EUR",
    "PT": "EUR", "FI": "EUR", "GR": "EUR", "LU": "EUR", "MT": "EUR", "CY": "EUR",
}
DEFAULT_CURRENCY = "QAR"
MAX_PRODUCTS_PER_CARD = 60
SLOT_MINUTES = (15, 30, 45, 60)
MIN_DAYS_AHEAD, MAX_DAYS_AHEAD = 7, 90
MAX_BUFFER_MINUTES = 60
DEFAULT_TIMEZONE = "Asia/Qatar"


def default_currency(workspace):
    return COUNTRY_CURRENCIES.get((getattr(workspace, "country", None) or "").upper(), DEFAULT_CURRENCY)


class Product(models.Model):
    """Something a visitor can put in the cart: a dish, an item for sale, a listing, a service."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey("cards.Card", on_delete=models.CASCADE, related_name="products")
    # The products section this item is shown in (a card may have up to three). Kept as a plain id so a section
    # can be removed without taking its products along; the editor re-attaches orphans to another section.
    section_id = models.UUIDField(null=True, blank=True)
    title = models.CharField(max_length=80)
    description = models.CharField(max_length=300, blank=True, default="")
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    currency = models.CharField(max_length=3, default=DEFAULT_CURRENCY)
    image = models.ImageField(upload_to="products/", blank=True, null=True)
    badge = models.CharField(max_length=20, blank=True, default="")
    # Free details drawn by the section (beds, baths, size for listings; tags for a menu).
    meta = models.JSONField(default=dict, blank=True)
    on = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)
    # Null means unlimited; a number is reduced by every order and the item sells out at zero.
    stock = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "created_at"]
        indexes = [models.Index(fields=["card", "order"], name="cards_produ_card_id_5b0d1e_idx")]

    def __str__(self):
        return self.title


def default_weekly():
    return []


class BookingSettings(models.Model):
    """When a card takes bookings: the weekly windows, slot length and how far ahead a visitor may book."""

    card = models.OneToOneField("cards.Card", on_delete=models.CASCADE, related_name="booking_settings")
    enabled = models.BooleanField(default=False)
    timezone = models.CharField(max_length=64, default=DEFAULT_TIMEZONE)
    slot_minutes = models.PositiveSmallIntegerField(default=30)
    buffer_minutes = models.PositiveSmallIntegerField(default=0)
    days_ahead = models.PositiveSmallIntegerField(default=14)
    # [{"d": 0..6 (Monday 0 to Sunday 6, like the hours section), "from": "HH:MM", "to": "HH:MM"}, ...]; several windows per day allowed.
    weekly = models.JSONField(default=default_weekly, blank=True)
    location_note = models.CharField(max_length=120, blank=True, default="")
    meet_link = models.URLField(max_length=500, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Booking settings of {self.card_id}"


class Booking(models.Model):
    """One appointment a visitor asked for. Times are stored in UTC; the card's timezone shows them."""

    STATUSES = [("requested", "requested"), ("confirmed", "confirmed"), ("cancelled", "cancelled"), ("done", "done")]
    ACTIVE_STATUSES = ("requested", "confirmed")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey("cards.Card", on_delete=models.CASCADE, related_name="bookings")
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    name = models.CharField(max_length=120)
    email = models.EmailField()
    phone = models.CharField(max_length=40, blank=True, default="")
    note = models.CharField(max_length=500, blank=True, default="")
    status = models.CharField(max_length=10, choices=STATUSES, default="requested")
    consented_at = models.DateTimeField(null=True, blank=True)
    # Snapshot at creation of the card holder's "share my new contacts with the company" switch (see workspaces/sharing.py).
    shared_with_company = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["start_at"]
        indexes = [
            models.Index(fields=["card", "start_at"], name="cards_booki_card_id_9f2c47_idx"),
            models.Index(fields=["card", "created_at"], name="cards_booki_card_id_3e81aa_idx"),
        ]

    def __str__(self):
        return f"{self.name} at {self.start_at:%Y-%m-%d %H:%M}"
