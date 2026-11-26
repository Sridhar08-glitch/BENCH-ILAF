import uuid

from django.conf import settings
from django.db import models

from workspaces.models import Workspace


class Plan(models.Model):
    """A sellable plan. Prices are editable in the admin; seed_plans only creates the starting set."""

    code = models.SlugField(primary_key=True, max_length=40)
    name = models.CharField(max_length=80)
    kind = models.CharField(max_length=10, choices=[("personal", "personal"), ("company", "company")])
    interval = models.CharField(max_length=5, choices=[("year", "year"), ("month", "month")], default="year")
    price_minor = models.PositiveIntegerField(help_text="Price in minor units (dirhams for QAR). Per seat when per_seat.")
    currency = models.CharField(max_length=3, default="QAR")
    max_cards = models.PositiveIntegerField(default=1, help_text="Cards allowed (per seat for per-seat plans).")
    per_seat = models.BooleanField(default=False)
    min_seats = models.PositiveIntegerField(default=1)
    features = models.JSONField(default=list, blank=True)
    active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "code"]

    def __str__(self):
        return self.name


class Subscription(models.Model):
    """The paid period of one workspace. A period is bought once and extended by paying again."""

    workspace = models.OneToOneField(Workspace, on_delete=models.CASCADE, related_name="subscription")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(
        max_length=10, choices=[("active", "active"), ("expired", "expired")], default="active"
    )
    seats_total = models.PositiveIntegerField(default=1)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    # The ends_at value each reminder was last sent for, so a reminder is never sent twice for one period.
    reminder_7_for = models.DateTimeField(null=True, blank=True)
    reminder_1_for = models.DateTimeField(null=True, blank=True)
    # The same idea for the free week: the ends_at its "ends soon" and "has ended" e-mails were sent for.
    free_reminder_for = models.DateTimeField(null=True, blank=True)
    free_ended_for = models.DateTimeField(null=True, blank=True)
    # Automatic renewal (Stripe subscription). auto_renew is true while Stripe will charge for the next period;
    # cancel_at_period_end means the owner switched it off (the period still runs to ends_at).
    stripe_customer_id = models.CharField(max_length=64, blank=True, default="")
    stripe_subscription_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    auto_renew = models.BooleanField(default=False)
    cancel_at_period_end = models.BooleanField(default=False)
    # Set when Stripe could not charge the card for a renewal; cleared by the next paid invoice.
    payment_failed_at = models.DateTimeField(null=True, blank=True)
    failed_invoice_id = models.CharField(max_length=64, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.workspace} until {self.ends_at:%Y-%m-%d}"


class InvoiceSequence(models.Model):
    """One counter row that hands out gap-free invoice numbers."""

    name = models.CharField(max_length=20, primary_key=True)
    value = models.PositiveIntegerField(default=0)


class Payment(models.Model):
    """A completed payment and its invoice."""

    SOURCES = [("stripe", "stripe"), ("dev", "dev"), ("manual", "manual")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    number = models.CharField(max_length=24, unique=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="payments")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="payments")
    seats = models.PositiveIntegerField(default=1)
    amount_minor = models.PositiveIntegerField()
    currency = models.CharField(max_length=3)
    # Unique so a Stripe event delivered twice can never grant two periods.
    stripe_session_id = models.CharField(max_length=255, unique=True, null=True, blank=True)
    # The Stripe invoice of a subscription payment, unique for the same reason (an invoice event may arrive twice).
    stripe_invoice_id = models.CharField(max_length=255, unique=True, null=True, blank=True)
    source = models.CharField(max_length=10, choices=SOURCES, default="stripe")
    period_start = models.DateTimeField()
    period_end = models.DateTimeField()
    paid_at = models.DateTimeField()

    class Meta:
        ordering = ["-paid_at"]

    def __str__(self):
        return self.number


class EnterpriseRequest(models.Model):
    """A company's request for an Enterprise quote. Bench staff set the seats and the price for that customer; the
    owner accepts and pays; the plan then renews like the others. One open (requested or quoted) request per company."""

    STATUSES = [(s, s) for s in ("requested", "quoted", "accepted", "declined", "cancelled")]
    OPEN = ("requested", "quoted")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="enterprise_requests")
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    seats_wanted = models.PositiveIntegerField()
    message = models.TextField(blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")
    status = models.CharField(max_length=10, choices=STATUSES, default="requested")
    quoted_seats = models.PositiveIntegerField(null=True, blank=True)
    # Per seat and per year, in minor units, like Plan.price_minor.
    quoted_price_per_seat_minor = models.PositiveIntegerField(null=True, blank=True)
    currency = models.CharField(max_length=3, default="QAR")
    interval = models.CharField(max_length=5, default="year")
    staff_note = models.CharField(max_length=500, blank=True, default="")
    quoted_by = models.CharField(max_length=254, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    quoted_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace"], condition=models.Q(status__in=("requested", "quoted")), name="one_open_enterprise_request",
            ),
        ]

    @property
    def quoted_total_minor(self):
        if self.quoted_seats is None or self.quoted_price_per_seat_minor is None:
            return None
        return self.quoted_seats * self.quoted_price_per_seat_minor

    def __str__(self):
        return f"{self.workspace_id} {self.status}"
