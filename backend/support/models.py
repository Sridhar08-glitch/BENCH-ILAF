"""Customer support: tickets with e-mail replies, live chat, staff presence and the support settings."""
import secrets
import uuid

from django.conf import settings
from django.db import models

from designs.models import PrivateStorage

CATEGORIES = ("account", "billing", "cards_design", "team_company", "bug", "feature_request", "privacy_data", "other")
PRIORITIES = ("low", "normal", "high", "urgent")
STATUSES = ("new", "open", "waiting_customer", "solved", "closed")
OPEN_STATUSES = ("new", "open", "waiting_customer")
CHANNELS = ("form", "chat", "email")


def _choices(values):
    return [(v, v) for v in values]


def default_hours():
    """Sunday to Thursday, 09:00-17:00 (the usual Qatar working week); a missing day is closed."""
    return {day: [["09:00", "17:00"]] for day in ("sun", "mon", "tue", "wed", "thu")}


def default_sla():
    """Minutes: first reply and resolution, counted in business hours."""
    return {
        "low": {"first": 960, "resolve": 4800},
        "normal": {"first": 480, "resolve": 2880},
        "high": {"first": 240, "resolve": 1440},
        "urgent": {"first": 60, "resolve": 480},
    }


class SupportSettings(models.Model):
    """One row (pk 1) that the admins edit in the staff area."""

    timezone = models.CharField(max_length=40, default="Asia/Qatar")
    business_hours = models.JSONField(default=default_hours, blank=True)
    holidays = models.JSONField(default=list, blank=True)
    chat_enabled = models.BooleanField(default=True)
    chat_accept_seconds = models.PositiveIntegerField(default=120)
    # Shown to the customer when a ticket arrives (and when a chat is turned into one because nobody is online).
    auto_reply_en = models.TextField(blank=True, default="Thanks for contacting us. We have your request and will reply as soon as we can.")
    auto_reply_ar = models.TextField(blank=True, default="شكرًا لتواصلك معنا. استلمنا طلبك وسنرد عليك في أقرب وقت ممكن.")
    offline_reply_en = models.TextField(blank=True, default="Nobody is online right now, so we turned your message into a request. We will answer by e-mail.")
    offline_reply_ar = models.TextField(blank=True, default="لا يوجد أحد متاح الآن، لذلك حوّلنا رسالتك إلى طلب دعم. سنرد عليك عبر البريد الإلكتروني.")
    sla = models.JSONField(default=default_sla, blank=True)
    blocked_words = models.JSONField(default=list, blank=True)
    inbound_address = models.CharField(max_length=254, blank=True, default="")
    ticket_counter = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)


class SupportTicket(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    number = models.PositiveIntegerField(unique=True)
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="support_tickets")
    requester_email = models.CharField(max_length=254, db_index=True)
    requester_name = models.CharField(max_length=120, blank=True)
    language = models.CharField(max_length=5, default="en")
    workspace = models.ForeignKey("workspaces.Workspace", null=True, blank=True, on_delete=models.SET_NULL, related_name="support_tickets")
    subject = models.CharField(max_length=200)
    category = models.CharField(max_length=20, choices=_choices(CATEGORIES), default="other", db_index=True)
    priority = models.CharField(max_length=10, choices=_choices(PRIORITIES), default="normal", db_index=True)
    status = models.CharField(max_length=20, choices=_choices(STATUSES), default="new", db_index=True)
    channel = models.CharField(max_length=10, choices=_choices(CHANNELS), default="form")
    assigned_staff = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_support_tickets")
    context = models.JSONField(default=dict, blank=True)
    ip_hash = models.CharField(max_length=32, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    first_response_at = models.DateTimeField(null=True, blank=True)
    solved_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    last_message_at = models.DateTimeField(null=True, blank=True)
    last_author_kind = models.CharField(max_length=10, blank=True)
    customer_seen_at = models.DateTimeField(null=True, blank=True)
    # SLA: due times are fixed in business hours when the ticket is made or its priority changes.
    first_due_at = models.DateTimeField(null=True, blank=True, db_index=True)
    resolve_due_at = models.DateTimeField(null=True, blank=True, db_index=True)
    sla_paused_at = models.DateTimeField(null=True, blank=True)
    sla_alerted_at = models.DateTimeField(null=True, blank=True)
    rating = models.PositiveSmallIntegerField(null=True, blank=True)
    rating_comment = models.CharField(max_length=500, blank=True)
    rated_at = models.DateTimeField(null=True, blank=True)
    merged_into = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="merged_from")
    spam = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at", "-number"]
        indexes = [models.Index(fields=["status", "assigned_staff"]), models.Index(fields=["requester", "status"])]

    @property
    def label(self):
        return f"{settings.SUPPORT_TICKET_PREFIX}-{self.number:05d}"


class SupportMessage(models.Model):
    AUTHORS = _choices(("customer", "staff", "system"))
    KINDS = _choices(("message", "status", "transcript"))
    VIA = _choices(("web", "email", "chat"))

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ticket = models.ForeignKey(SupportTicket, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    author_kind = models.CharField(max_length=10, choices=AUTHORS)
    author_name = models.CharField(max_length=120, blank=True)
    kind = models.CharField(max_length=12, choices=KINDS, default="message")
    body = models.TextField(blank=True, default="")
    internal = models.BooleanField(default=False)
    via = models.CharField(max_length=6, choices=VIA, default="web")
    status_to = models.CharField(max_length=20, blank=True)
    email_message_id = models.CharField(max_length=300, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]


def attachment_name(instance, filename):
    return f"support/{secrets.token_hex(16)}"


class SupportAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ticket = models.ForeignKey(SupportTicket, null=True, blank=True, on_delete=models.CASCADE, related_name="attachments")
    message = models.ForeignKey(SupportMessage, null=True, blank=True, on_delete=models.SET_NULL, related_name="attachments")
    chat_session = models.ForeignKey("support.ChatSession", null=True, blank=True, on_delete=models.CASCADE, related_name="attachments")
    chat_message = models.ForeignKey("support.ChatMessage", null=True, blank=True, on_delete=models.SET_NULL, related_name="attachments")
    uploaded_by_kind = models.CharField(max_length=10, default="customer")
    original_name = models.CharField(max_length=120)
    content_type = models.CharField(max_length=40)
    size = models.PositiveIntegerField()
    file = models.FileField(upload_to=attachment_name, storage=PrivateStorage(), max_length=200)
    # Where a virus scan can plug in: "pending" until a scanner says "clean" or "infected" (see services.scan_attachment).
    scan_status = models.CharField(max_length=10, default="clean")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class ChatSession(models.Model):
    STATUSES = _choices(("waiting", "active", "ended", "offline_converted"))

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="support_chats")
    visitor_name = models.CharField(max_length=120, blank=True)
    visitor_email = models.CharField(max_length=254, blank=True)
    token_hash = models.CharField(max_length=64, blank=True, db_index=True)
    language = models.CharField(max_length=5, default="en")
    workspace = models.ForeignKey("workspaces.Workspace", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    status = models.CharField(max_length=20, choices=STATUSES, default="waiting", db_index=True)
    ticket = models.ForeignKey(SupportTicket, null=True, blank=True, on_delete=models.SET_NULL, related_name="chats")
    assigned_staff = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="support_chats_assigned")
    context = models.JSONField(default=dict, blank=True)
    ip_hash = models.CharField(max_length=32, blank=True, db_index=True)
    spam_hits = models.PositiveSmallIntegerField(default=0)
    started_at = models.DateTimeField(auto_now_add=True, db_index=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    ended_by = models.CharField(max_length=10, blank=True)
    last_activity = models.DateTimeField(auto_now_add=True)
    visitor_typing_at = models.DateTimeField(null=True, blank=True)
    staff_typing_at = models.DateTimeField(null=True, blank=True)
    visitor_read_id = models.BigIntegerField(default=0)
    staff_read_id = models.BigIntegerField(default=0)
    transcript_sent = models.BooleanField(default=False)

    class Meta:
        ordering = ["-started_at"]
        indexes = [models.Index(fields=["status", "assigned_staff"])]


class ChatMessage(models.Model):
    AUTHORS = _choices(("customer", "staff", "system"))

    id = models.BigAutoField(primary_key=True)
    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    author_kind = models.CharField(max_length=10, choices=AUTHORS)
    author_name = models.CharField(max_length=120, blank=True)
    body = models.TextField(blank=True, default="")
    delivery = models.CharField(max_length=10, default="sent")  # sent, delivered, read
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]


class StaffPresence(models.Model):
    STATUSES = _choices(("online", "away", "offline"))

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="support_presence")
    status = models.CharField(max_length=10, choices=STATUSES, default="offline")
    capacity = models.PositiveSmallIntegerField(default=3)
    last_seen = models.DateTimeField(null=True, blank=True)


class BannedVisitor(models.Model):
    ip_hash = models.CharField(max_length=32, db_index=True)
    reason = models.CharField(max_length=200, blank=True)
    expires_at = models.DateTimeField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)


class CannedReply(models.Model):
    """A saved answer with {placeholders}: {name}, {ticket}, {agent}, {product}."""

    title = models.CharField(max_length=80)
    body_en = models.TextField()
    body_ar = models.TextField(blank=True, default="")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["title", "id"]


class InboundMail(models.Model):
    """The Message-ID of every e-mail already handled, so a mail fetched twice is never added twice."""

    message_id = models.CharField(max_length=300, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
