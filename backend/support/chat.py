"""Live chat: who is online, the life of a chat, messages with `since` cursors, transcripts and the conversion to a ticket."""
import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from ilaf.errors import ApiError
from ilaf.i18n import language_or_default, tr
from ilaf.utils import iso, run_after_response

from . import hours, services
from .models import ChatMessage, ChatSession, StaffPresence

AWAY_AFTER = timedelta(minutes=5)
IDLE_END = timedelta(minutes=30)
TYPING_FOR = timedelta(seconds=6)
MAX_CHAT_BODY = 2000
SWEEP_KEY = "support:chat-sweep"


# ================================================================ presence
def refresh_presence(now=None):
    """Staff who have not sent a heartbeat for five minutes go away."""
    now = now or timezone.now()
    StaffPresence.objects.filter(status="online", last_seen__lt=now - AWAY_AFTER).update(status="away")
    StaffPresence.objects.filter(status="online", last_seen__isnull=True).update(status="away")


def set_presence(user, status):
    row, _ = StaffPresence.objects.get_or_create(user=user)
    row.status = status
    row.last_seen = timezone.now()
    row.save(update_fields=["status", "last_seen"])
    return row


def heartbeat(user):
    """A heartbeat keeps an online person online and brings back someone who went away by timeout, not one who chose away."""
    row, _ = StaffPresence.objects.get_or_create(user=user)
    row.last_seen = timezone.now()
    row.save(update_fields=["last_seen"])
    return row


def active_count(user):
    return ChatSession.objects.filter(status="active", assigned_staff=user).count()


def online_agents(now=None):
    now = now or timezone.now()
    out = []
    for row in StaffPresence.objects.filter(status="online", last_seen__gte=now - AWAY_AFTER).select_related("user"):
        if row.user.is_active and row.user.staff_role in ("support", "admin"):
            out.append(row)
    return out


def chat_allowed(workspace=None, c=None):
    """Whether new live chats are allowed: the support setting is on and the `support_chat` feature switch is on for the
    caller's company (for a caller without a company, unless the switch is off for everybody)."""
    from staff import flags

    c = c or services.cfg()
    if not c.chat_enabled:
        return False
    if workspace is None:
        return not flags.switched_off("support_chat")
    return flags.flag_enabled("support_chat", workspace)


def availability(now=None, workspace=None):
    """What the chat widget shows: whether chat is switched on (setting and feature switch), whether the team is in business
    hours and whether somebody with room is online. `online` is true only when a chat can really be answered, `live` says the
    same thing for a new chat and `reason` says why not: switched_off, closed, nobody_online or online. Chats that are already
    running are not affected by a switch."""
    now = now or timezone.now()
    c = services.cfg()
    refresh_presence(now)
    allowed = chat_allowed(workspace, c)
    in_hours = hours.is_open(c, now)
    agents = [a for a in online_agents(now) if active_count(a.user) < a.capacity]
    online = bool(allowed and in_hours and agents)
    reason = "online" if online else "switched_off" if not allowed else "closed" if not in_hours else "nobody_online"
    return {
        "enabled": allowed, "online": online, "live": online, "reason": reason,
        "in_business_hours": in_hours, "accept_seconds": c.chat_accept_seconds,
    }


# ================================================================ sessions
def hash_token(token):
    return hashlib.sha256(f"chat|{token}|{settings.SECRET_KEY}".encode("utf-8")).hexdigest()


def new_token():
    return secrets.token_urlsafe(24)


def visitor_label(session):
    return session.visitor_name or (session.user.full_name if session.user else "") or session.visitor_email or "Visitor"


def add_message(session, author_kind, user, body, name=""):
    body = services.clean_text(body, "body", MAX_CHAT_BODY)
    msg = ChatMessage.objects.create(
        session=session, author=user, author_kind=author_kind, body=body,
        author_name=(name or (services.staff_name(user) if author_kind == "staff" else visitor_label(session) if author_kind == "customer" else ""))[:120],
    )
    ChatSession.objects.filter(pk=session.pk).update(last_activity=msg.created_at)
    session.last_activity = msg.created_at
    return msg


def system_message(session, body):
    return ChatMessage.objects.create(session=session, author_kind="system", body=body)


def start(*, user, name, email, language, context, ip_hash, workspace=None, first_message=""):
    """Open a chat. With nobody to answer (chat switched off, outside business hours, nobody online) the visitor's message
    becomes a ticket at once and the session is `offline_converted`; otherwise the session waits for staff to accept it."""
    services.refuse_if_banned(ip_hash)
    existing = services.open_chat_for(user, ip_hash)
    if existing is not None:
        raise ApiError("support_chat_open_exists", "You already have a chat open.", 409, {"chat_id": [str(existing.id)]})
    state = availability(workspace=workspace)
    token = new_token() if user is None else ""
    session = ChatSession.objects.create(
        user=user, visitor_name=(name or "")[:120], visitor_email=(email or "").lower()[:254], token_hash=hash_token(token) if token else "",
        language=language_or_default(language), context=context or {}, ip_hash=ip_hash, workspace=workspace,
    )
    if first_message:
        add_message(session, "customer", user, first_message)
    if not state["online"]:
        if not first_message:
            session.delete()
            raise ApiError("support_chat_offline", "Nobody is online right now. Leave us a message and we will answer by e-mail.", 409)
        convert_to_ticket(session, offline=True)
    session.start_reason = state["reason"]
    return session, token


def authorize(request, session_id):
    """The chat this request may use: the signed-in owner, or the visitor with the right token. Anyone else gets a 404."""
    from django.http import Http404

    try:
        session = ChatSession.objects.select_related("user").get(pk=session_id)
    except (ChatSession.DoesNotExist, ValueError, Exception):
        raise Http404
    user = getattr(request, "user", None)
    if user is not None and getattr(user, "is_authenticated", False):
        if session.user_id == user.id:
            return session
        raise Http404
    token = request.META.get("HTTP_X_CHAT_TOKEN", "")
    if session.user_id is None and session.token_hash and token and secrets.compare_digest(session.token_hash, hash_token(token)):
        return session
    raise Http404


def throttle_sweep():
    """Run the chat sweep at most every few seconds, from whichever request comes first (cron does it too)."""
    if cache.add(SWEEP_KEY, 1, 5):
        sweep()


def sweep(now=None):
    """Chats nobody accepted in time become tickets, idle chats end, people who stopped sending heartbeats go away."""
    now = now or timezone.now()
    c = services.cfg()
    refresh_presence(now)
    converted = ended = 0
    in_hours = hours.is_open(c, now)
    has_agent = bool(online_agents(now))
    for session in ChatSession.objects.filter(status="waiting").select_related("user", "workspace"):
        waited = now - session.started_at
        if waited >= timedelta(seconds=c.chat_accept_seconds) or not chat_allowed(session.workspace, c) or not (in_hours and has_agent):
            convert_to_ticket(session, offline=True)
            converted += 1
    for session in ChatSession.objects.filter(status="active", last_activity__lt=now - IDLE_END).select_related("user"):
        end(session, "system")
        ended += 1
    return converted, ended


# ================================================================ staff actions
def accept(session, user):
    with transaction.atomic():
        locked = ChatSession.objects.select_for_update().get(pk=session.pk)
        if locked.status != "waiting":
            raise ApiError("support_chat_taken", "Another person already took this chat.", 409)
        locked.status = "active"
        locked.assigned_staff = user
        locked.accepted_at = timezone.now()
        locked.last_activity = locked.accepted_at
        locked.save(update_fields=["status", "assigned_staff", "accepted_at", "last_activity"])
    return locked


def transfer(session, to_user):
    if session.status != "active":
        raise ApiError("support_chat_ended", "This chat has ended.", 409)
    session.assigned_staff = to_user
    session.save(update_fields=["assigned_staff"])
    system_message(session, "transferred")
    return session


def transcript_text(session, lang="en"):
    lines = []
    for m in session.messages.all():
        if m.author_kind == "system":
            continue
        who = m.author_name or (tr(lang, "Support") if m.author_kind == "staff" else tr(lang, "Visitor"))
        lines.append(f"[{m.created_at.strftime('%Y-%m-%d %H:%M')}] {who}: {m.body}")
    return "\n".join(lines)


def _ensure_ticket(session, status):
    """The ticket that holds this chat: made on first need, with the whole transcript added once."""
    if session.ticket_id is None:
        first = next((m.body for m in session.messages.all() if m.author_kind == "customer"), "")
        subject = services.snippet(first, 80) or tr(language_or_default(session.language), "Live chat")
        user = session.user
        ticket = services.create_ticket(
            user=user, email=(user.email if user else session.visitor_email), name=(session.visitor_name or (user.full_name if user else "")),
            subject=subject, body=services.snippet(first, 2000) or tr(language_or_default(session.language), "Live chat"),
            category="other", channel="chat", workspace=session.workspace, context=session.context, language=session.language,
            ip_hash=session.ip_hash, via="chat", notify=False, offline_reply=False,
        )
        session.ticket = ticket
        session.save(update_fields=["ticket"])
    ticket = session.ticket
    text = transcript_text(session, language_or_default(session.language))
    if text and not ticket.messages.filter(kind="transcript").exists():
        services.add_message(ticket, "system", None, text, kind="transcript", via="chat")
    if status == "solved" and ticket.status in ("new", "open", "waiting_customer"):
        services.set_status(ticket, "solved", "system", note="")
    return ticket


def convert_to_ticket(session, offline=False, by_staff=None):
    """Turn a chat into a ticket. An unanswered chat becomes `offline_converted`; a chat converted by staff ends as a normal
    chat with the ticket linked. The customer gets the auto-reply e-mail and the transcript is added to the ticket."""
    if session.status in ("ended", "offline_converted"):
        return session.ticket
    had_ticket = session.ticket_id is not None
    ticket = _ensure_ticket(session, "open")
    now = timezone.now()
    session.status = "offline_converted" if offline else "ended"
    session.ended_at = now
    session.ended_by = "system" if offline else "staff"
    session.save(update_fields=["status", "ended_at", "ended_by"])
    if offline:
        system_message(session, "converted")
    if ticket.requester_email and not had_ticket:
        run_after_response(services.notify_created, ticket.pk, offline)
    if by_staff is not None:
        if ticket.assigned_staff_id is None:
            ticket.assigned_staff = by_staff
            ticket.save(update_fields=["assigned_staff", "updated_at"])
        if ticket.status == "new":
            services.set_status(ticket, "open", "staff", by_staff)
    return ticket


def end(session, who):
    """End a chat: the transcript goes to the customer by e-mail and into a ticket (made when there is none)."""
    if session.status in ("ended", "offline_converted"):
        return session
    if session.status == "waiting":
        convert_to_ticket(session, offline=True)
        return session
    session.status = "ended"
    session.ended_at = timezone.now()
    session.ended_by = who
    session.save(update_fields=["status", "ended_at", "ended_by"])
    system_message(session, "ended")
    ticket = _ensure_ticket(session, "solved")
    if ticket.first_response_at is None and ChatMessage.objects.filter(session=session, author_kind="staff").exists():
        ticket.first_response_at = session.accepted_at or timezone.now()
        ticket.save(update_fields=["first_response_at"])
    run_after_response(send_transcript, session.pk)
    return session


def send_transcript(session_id):
    session = ChatSession.objects.select_related("user", "ticket").filter(pk=session_id).first()
    if session is None or session.transcript_sent:
        return
    address = session.user.email if session.user else session.visitor_email
    if not address or session.ticket is None:
        return
    lang = language_or_default(session.language)
    text = transcript_text(session, lang)
    if not text:
        return
    session.transcript_sent = True
    session.save(update_fields=["transcript_sent"])
    services._mail(
        address, lang, tr(lang, "Your chat transcript"), tr(lang, "Your chat transcript"),
        [tr(lang, "Here is a copy of your chat with our team. It is saved with request {ticket}.", ticket=session.ticket.label)],
        session.ticket, raw=[text], automatic=True,
    )


# ================================================================ reading and typing
def message_json(m):
    return {"id": m.id, "author": m.author_kind, "author_name": m.author_name, "body": m.body, "created_at": iso(m.created_at), "delivery": m.delivery,
            "files": [services.attachment_json(a) for a in m.attachments.all()]}


def poll(session, since, viewer):
    """Messages after the cursor plus the state of the chat. `viewer` is "customer" or "staff": reading marks the other
    side's messages as read and says whether the other side is typing."""
    qs = session.messages.filter(id__gt=since).prefetch_related("attachments")[:200]
    messages = list(qs)
    now = timezone.now()
    other = "staff" if viewer == "customer" else "customer"
    latest_other = max((m.id for m in messages if m.author_kind == other), default=0)
    if latest_other:
        field = "visitor_read_id" if viewer == "customer" else "staff_read_id"
        if latest_other > getattr(session, field):
            ChatSession.objects.filter(pk=session.pk).update(**{field: latest_other})
            setattr(session, field, latest_other)
    typing_at = session.staff_typing_at if viewer == "customer" else session.visitor_typing_at
    out = {
        "messages": [message_json(m) for m in messages],
        "status": session.status, "typing": bool(typing_at and now - typing_at < TYPING_FOR),
        "read_id": session.staff_read_id if viewer == "customer" else session.visitor_read_id,
        "staff_name": services.staff_name(session.assigned_staff) if session.assigned_staff_id else "",
        "ticket": session.ticket.label if session.ticket_id else None,
    }
    if session.ticket_id is not None:
        out["ticket_id"] = str(session.ticket_id)
    return out


def mark_typing(session, viewer):
    field = "staff_typing_at" if viewer == "staff" else "visitor_typing_at"
    ChatSession.objects.filter(pk=session.pk).update(**{field: timezone.now()})


def session_json(s, staff=False):
    out = {
        "id": str(s.id), "status": s.status, "started_at": iso(s.started_at), "ended_at": iso(s.ended_at),
        "last_activity": iso(s.last_activity), "staff_name": services.staff_name(s.assigned_staff) if s.assigned_staff_id else "",
    }
    if staff:
        last = s.messages.order_by("-id").first()
        out.update({
            "visitor": visitor_label(s), "visitor_email": s.user.email if s.user else s.visitor_email,
            "signed_in": s.user_id is not None, "assigned_to": str(s.assigned_staff_id) if s.assigned_staff_id else None,
            "ticket_id": str(s.ticket_id) if s.ticket_id else None, "ticket": s.ticket.label if s.ticket_id else None,
            "language": s.language, "context": s.context, "spam_hits": s.spam_hits,
            "last_message": services.snippet(last.body, 120) if last else "", "ip_hash": s.ip_hash,
            "workspace_id": str(s.workspace_id) if s.workspace_id else None,
        })
    return out
