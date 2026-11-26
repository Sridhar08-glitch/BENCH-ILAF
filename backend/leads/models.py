import uuid

from django.db import models

from cards.models import Card


class Lead(models.Model):
    STATUSES = [
        ("new", "new"), ("contacted", "contacted"), ("qualified", "qualified"), ("won", "won"), ("lost", "lost"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Leads belong to the company: when a card is deleted they stay, with the card's name kept as text.
    card = models.ForeignKey(Card, null=True, blank=True, on_delete=models.SET_NULL, related_name="leads")
    workspace = models.ForeignKey(
        "workspaces.Workspace", null=True, blank=True, on_delete=models.CASCADE, related_name="leads"
    )
    card_name = models.CharField(max_length=120, blank=True)
    name = models.CharField(max_length=120)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=40, blank=True)
    company = models.CharField(max_length=120, blank=True)
    note = models.TextField(blank=True)
    # Where the lead came from: exchange (visitor shared details), meeting_request, scanned_card, event (met in person), or the old link/qr/nfc/email.
    source = models.CharField(max_length=20, default="link")
    # Event mode: a short tag (hot, warm, follow_up), the event's name, and the id the phone made up so a retry cannot add the lead twice.
    tag = models.CharField(max_length=20, blank=True, default="")
    event_name = models.CharField(max_length=120, blank=True, default="")
    client_ref = models.CharField(max_length=64, blank=True, default="", db_index=True)
    # How the visitor reached the card (nfc, qr, link, email) when known.
    channel = models.CharField(max_length=10, blank=True, default="")
    # Meeting requests: up to three preferred times, as typed by the visitor.
    meeting_times = models.JSONField(default=list, blank=True)
    consented_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUSES, default="new")
    # Company leads can be handed to a colleague; the lead stays when that member leaves.
    assignee = models.ForeignKey(
        "workspaces.Member", null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_leads"
    )
    assigned_at = models.DateTimeField(null=True, blank=True)
    # Snapshot taken when the lead arrives: True when the holder of the card had "share my new contacts with the company" on at that
    # moment. It never changes afterwards (see workspaces/sharing.py).
    shared_with_company = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["card", "created_at"]),
            models.Index(fields=["workspace", "created_at"]),
            models.Index(fields=["workspace", "assignee", "status"]),
        ]


class LeadNote(models.Model):
    """An internal note on a lead. Never shown to the visitor and never sent to webhooks."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="notes")
    author = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    author_name = models.CharField(max_length=120, blank=True)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class LeadActivity(models.Model):
    """One line of a lead's timeline: created, assigned, status_changed, note_added, emailed."""

    KINDS = ["created", "assigned", "status_changed", "note_added", "emailed"]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="activity")
    kind = models.CharField(max_length=20)
    actor = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    actor_name = models.CharField(max_length=120, blank=True)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["lead", "created_at"])]


class WebhookEndpoint(models.Model):
    """A company's web address that receives signed lead events."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="webhooks")
    name = models.CharField(max_length=80, blank=True)
    url = models.URLField(max_length=500)
    secret = models.CharField(max_length=80)
    events = models.JSONField(default=list)
    enabled = models.BooleanField(default=True)
    consecutive_failures = models.PositiveIntegerField(default=0)
    disabled_reason = models.CharField(max_length=200, blank=True)
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class WebhookDelivery(models.Model):
    """One event waiting for, or already sent to, one endpoint. The command `deliver_webhooks` works through the queue."""

    STATUSES = [("pending", "pending"), ("success", "success"), ("failed", "failed")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    endpoint = models.ForeignKey(WebhookEndpoint, on_delete=models.CASCADE, related_name="deliveries")
    event_id = models.UUIDField(default=uuid.uuid4)
    event_type = models.CharField(max_length=40)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=10, choices=STATUSES, default="pending")
    attempts = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField(null=True, blank=True)
    # While a worker holds a delivery, others skip it until this time passes.
    locked_until = models.DateTimeField(null=True, blank=True)
    response_status = models.PositiveIntegerField(null=True, blank=True)
    response_body = models.CharField(max_length=1000, blank=True)
    error = models.CharField(max_length=300, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    is_test = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "next_attempt_at"]),
            models.Index(fields=["endpoint", "-created_at"]),
        ]


class LeadSeen(models.Model):
    """When a person last looked at the new-contacts bell of a workspace, so the unread count is personal."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="+")
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE, related_name="+")
    seen_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "workspace"], name="one_lead_seen_per_person_and_workspace")]


def company_owned_leads(workspace):
    """The contacts that belong to the company itself: those of the company's own card, those saved by hand with no card, and those an
    employee shared (their switch was on when the contact arrived). The other contacts of an employee's card belong to that employee. Everything that sends contacts out of the product for the company (webhooks, CRM
    connectors, the developer API, the company data export) is limited to these."""
    from django.db.models import Q

    return Lead.objects.filter(
        Q(workspace=workspace, card__isnull=True) | Q(card__workspace=workspace, card__is_company=True) | Q(card__workspace=workspace, card__member__isnull=True)
        | Q(workspace=workspace, shared_with_company=True)
    )


def is_company_owned(lead):
    """True for the company card's contacts, those of a card nobody holds, and those the holder shared (the employee's switch was on
    when they arrived). The one definition every channel uses: webhooks, CRM, the developer API, the exports, the activity log."""
    return not lead.card_id or bool(lead.card.is_company) or lead.card.member_id is None or bool(lead.shared_with_company)
