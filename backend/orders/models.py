"""An order a visitor placed from a card's products section."""
import secrets
import uuid

from django.db import models

# No 0/O or 1/I, so a number read out over the phone cannot be misheard.
NUMBER_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
NUMBER_LENGTH = 6
NUMBER_PREFIX = "B-"


def new_number():
    return NUMBER_PREFIX + "".join(secrets.choice(NUMBER_ALPHABET) for _ in range(NUMBER_LENGTH))


class Order(models.Model):
    PAYMENT_METHODS = [("cod", "cash on delivery"), ("whatsapp", "whatsapp"), ("card_later", "card later")]
    PAYMENT_STATUSES = [("unpaid", "unpaid"), ("paid", "paid"), ("refunded", "refunded")]
    STATUSES = [
        ("new", "new"), ("confirmed", "confirmed"), ("ready", "ready"), ("delivered", "delivered"), ("cancelled", "cancelled"),
    ]
    FINAL_STATUSES = ("delivered", "cancelled")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # The short number the customer keeps ("B-7K3MQ2"): what the status page and the phone call use.
    number = models.CharField(max_length=12, unique=True, editable=False)
    # Orders belong to the company: when a card is deleted they stay, with the card's name kept as text.
    card = models.ForeignKey("cards.Card", null=True, blank=True, on_delete=models.SET_NULL, related_name="orders")
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="orders")
    card_name = models.CharField(max_length=120, blank=True, default="")
    customer_name = models.CharField(max_length=120)
    customer_phone = models.CharField(max_length=40)
    customer_email = models.EmailField(blank=True, default="")
    note = models.CharField(max_length=500, blank=True, default="")
    address = models.CharField(max_length=300, blank=True, default="")
    # What was ordered, as it was at that moment: [{product_id, title, unit_price, currency, qty}].
    items = models.JSONField(default=list)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=3)
    payment_method = models.CharField(max_length=12, choices=PAYMENT_METHODS, default="cod")
    payment_status = models.CharField(max_length=10, choices=PAYMENT_STATUSES, default="unpaid")
    # Where a card payment happens once payments are connected; empty until then.
    pay_url = models.URLField(max_length=500, blank=True, default="")
    status = models.CharField(max_length=10, choices=STATUSES, default="new")
    consented_at = models.DateTimeField(null=True, blank=True)
    # Snapshot at creation of the card holder's "share my new contacts with the company" switch (see workspaces/sharing.py).
    shared_with_company = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["workspace", "created_at"], name="orders_orde_workspa_1c7d3b_idx"),
            models.Index(fields=["card", "created_at"], name="orders_orde_card_id_7a94e0_idx"),
            models.Index(fields=["workspace", "status"], name="orders_orde_workspa_52be1f_idx"),
        ]

    def __str__(self):
        return f"{self.number} ({self.status})"
