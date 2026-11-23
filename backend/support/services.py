"""Tickets, messages, attachments, the SLA clock, request context and the e-mails of the support system."""
import hashlib
import re
import secrets
from datetime import timedelta
from html import escape
from urllib.parse import urlsplit

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from ilaf.emails import brand_html_page, send_brand_html
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import language_for_email, language_or_default, tr, user_language
from ilaf.utils import iso, run_after_response

from . import hours
from .models import (
    OPEN_STATUSES, ChatSession, SupportAttachment, SupportMessage, SupportSettings, SupportTicket,
)

REOPEN_DAYS = 14
MAX_FILES_PER_MESSAGE = 5
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_BODY = 10000
MAX_SUBJECT = 200
REPLY_MARKER_EN = "##- Please type your reply above this line -##"
REPLY_MARKER_AR = "##- يرجى كتابة ردك أعلى هذا السطر -##"


# ================================================================ settings and numbers
def cfg():
    row, _ = SupportSettings.objects.get_or_create(pk=1)
    return row


def next_number():
    """The next ticket number. The counter row is updated in one statement, so two tickets never share a number."""
    cfg()
    with transaction.atomic():
        SupportSettings.objects.filter(pk=1).update(ticket_counter=F("ticket_counter") + 1)
        return SupportSettings.objects.values_list("ticket_counter", flat=True).get(pk=1)


def label_for(number):
    return f"{settings.SUPPORT_TICKET_PREFIX}-{number:05d}"


# ================================================================ text checks
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(value, field, max_len, required=True):
    value = (value or "")
    if not isinstance(value, str):
        raise validation_error({field: ["Enter some text."]})
    value = _CONTROL.sub("", value.replace("\r\n", "\n").replace("\r", "\n")).strip()
    if required and not value:
        raise validation_error({field: ["This field is required."]})
    if len(value) > max_len:
        raise validation_error({field: [f"Keep this under {max_len} characters."]})
    return value


def clean_subject(value):
    return clean_text(" ".join(str(value or "").split()), "subject", MAX_SUBJECT)


def check_blocked(text):
    """Raise when the text holds a word from the blocked-words setting. Returns nothing otherwise."""
    lowered = (text or "").lower()
    for word in cfg().blocked_words or []:
        word = str(word).strip().lower()
        if word and word in lowered:
            raise ApiError("support_blocked_content", "This message contains words we do not accept.", 400)


def banned(ip_hash):
    from .models import BannedVisitor

    return bool(ip_hash) and BannedVisitor.objects.filter(ip_hash=ip_hash, expires_at__gt=timezone.now()).exists()


def refuse_if_banned(ip_hash):
    if banned(ip_hash):
        raise ApiError("support_banned", "You cannot contact support from here right now.", 403)


# ================================================================ context (never secrets)
_SECRET_LIKE = re.compile(r"(eyJ[A-Za-z0-9_-]{10,}\.|bearer\s|[A-Za-z0-9_-]{32,}|password|passwd|secret|token)", re.I)
_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
CONTEXT_KEYS = ("page_url", "route", "app_language", "build_id", "card_id")


def parse_user_agent(ua):
    """A short browser and system name from a User-Agent header. Nothing else of the header is kept."""
    ua = (ua or "")[:400]
    browser = "Other"
    for needle, name in (("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Version/", "Safari")):
        match = re.search(re.escape(needle) + r"(\d+)", ua)
        if match and (name != "Safari" or "Safari" in ua):
            browser = f"{name} {match.group(1)}"
            break
    os_name = "Other"
    for needle, name in (("Windows", "Windows"), ("Android", "Android"), ("iPhone", "iOS"), ("iPad", "iPadOS"), ("Mac OS X", "macOS"), ("Linux", "Linux")):
        if needle in ua:
            os_name = name
            break
    return {"browser": browser, "os": os_name}


def _safe_text(value, limit):
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        return ""
    text = _CONTROL.sub("", str(value))[:limit]
    if _UUID.fullmatch(text):
        return text
    return "" if _SECRET_LIKE.search(text) else text


def _path_only(value):
    """The path of an address. A query string or fragment can hold tokens, so both are dropped."""
    text = str(value or "")[:500]
    if not text:
        return ""
    path = urlsplit(text).path if "://" in text else text.split("?", 1)[0].split("#", 1)[0]
    return path[:200] if path.startswith("/") and not _SECRET_LIKE.search(_UUID.sub("", path)) else ""


def clean_context(raw, request=None, user=None):
    """The context kept with a request. Only known fields survive, addresses lose their query string, anything that
    looks like a secret is dropped, and the role and plan come from the server, never from the page."""
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    for key in ("page_url", "route"):
        value = _path_only(raw.get(key))
        if value:
            out[key] = value
    for key in ("app_language", "build_id", "card_id"):
        value = _safe_text(raw.get(key), 40)
        if value:
            out[key] = value
    screen = raw.get("screen")
    if isinstance(screen, dict):
        try:
            width, height = int(screen.get("w")), int(screen.get("h"))
            if 0 < width < 20000 and 0 < height < 20000:
                out["screen"] = {"w": width, "h": height}
        except (TypeError, ValueError):
            pass
    if request is not None:
        out.update(parse_user_agent(request.META.get("HTTP_USER_AGENT", "")))
    workspace_id = _safe_text(raw.get("workspace_id"), 40)
    workspace = member_workspace(user, workspace_id)
    if workspace is not None:
        from billing.services import get_subscription
        from workspaces.models import Member

        out["workspace_id"] = str(workspace.id)
        member = Member.objects.filter(workspace=workspace, user=user, status="active").first()
        out["role"] = member.role if member else ""
        sub = get_subscription(workspace)
        out["plan_label"] = sub.plan.name if sub else ""
    return out


def member_workspace(user, workspace_id):
    """The workspace when the person is an active member of it, else None (a made-up id is ignored)."""
    if user is None or not getattr(user, "is_authenticated", False) or not workspace_id:
        return None
    from workspaces.models import Member, Workspace

    try:
        ws = Workspace.objects.filter(pk=workspace_id).first()
    except (ValueError, Exception):
        return None
    if ws is None or not Member.objects.filter(workspace=ws, user=user, status="active").exists():
        return None
    return ws


# ================================================================ files
MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"%PDF-", "application/pdf"),
)


def sniff(head, name=""):
    """The content type of a file from its first bytes. Text (.txt, .log) has no signature, so it must be plain text with the
    right file ending. Names and declared types are never trusted otherwise."""
    for prefix, ctype in MAGIC:
        if head.startswith(prefix):
            return ctype
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if name.lower().endswith((".txt", ".log")) and b"\x00" not in head:
        try:
            head.decode("utf-8")
        except UnicodeDecodeError as exc:
            if exc.start < len(head) - 4:  # a cut multi-byte character at the end of the sample is fine
                return None
        return "text/plain"
    return None


def clean_filename(name):
    name = re.sub(r"[\x00-\x1f\x7f\\/:*?\"<>|]+", "_", str(name or "file")).strip(" .")
    return (name or "file")[:120]


def scan_attachment(data, content_type):
    """Where a virus scanner plugs in: return "clean", "infected" or "pending". Set SUPPORT_VIRUS_SCAN to a dotted
    path of a function (data, content_type) -> status to use one. Without it every checked file is "clean"."""
    path = getattr(settings, "SUPPORT_VIRUS_SCAN", "")
    if not path:
        return "clean"
    from django.utils.module_loading import import_string

    return import_string(path)(data, content_type)


def check_upload(upload):
    """Validate one uploaded file; returns (bytes, content type)."""
    if upload is None:
        raise validation_error({"file": ["Choose a file to upload."]})
    if upload.size > MAX_FILE_BYTES:
        raise validation_error({"file": ["That file is larger than 10 MB."]})
    data = upload.read()
    upload.seek(0)
    ctype = sniff(data[:4096], getattr(upload, "name", ""))
    if ctype is None:
        raise validation_error({"file": ["Use a PNG, JPG, WebP, PDF, TXT or LOG file."]})
    if scan_attachment(data, ctype) == "infected":
        raise validation_error({"file": ["This file was refused because it may be unsafe."]})
    return data, ctype


def store_attachment(upload, kind, ticket=None, chat_session=None, message=None, chat_message=None, checked=None):
    data, ctype = checked or check_upload(upload)
    row = SupportAttachment(
        ticket=ticket, chat_session=chat_session, message=message, chat_message=chat_message, uploaded_by_kind=kind,
        original_name=clean_filename(getattr(upload, "name", "file")), content_type=ctype, size=len(data),
        scan_status=scan_attachment(data, ctype),
    )
    row.file.save("f", ContentFile(data), save=False)
    row.save()
    return row


def check_uploads(uploads):
    """Validate a message's files before anything is stored: at most five, each of an allowed type and size."""
    uploads = [u for u in (uploads or []) if u is not None]
    if len(uploads) > MAX_FILES_PER_MESSAGE:
        raise validation_error({"files": [f"You can attach at most {MAX_FILES_PER_MESSAGE} files to one message."]})
    return [(u, check_upload(u)) for u in uploads]


def attachment_json(a):
    return {
        "id": str(a.id), "name": a.original_name, "content_type": a.content_type, "size": a.size,
        "by": a.uploaded_by_kind, "message_id": str(a.message_id) if a.message_id else None, "created_at": iso(a.created_at),
    }


# ================================================================ SLA
def set_due_times(ticket):
    """Fix the first-reply and resolution deadlines from the priority, counting business hours from the moment it was made."""
    c = cfg()
    targets = (c.sla or {}).get(ticket.priority) or {}
    start = ticket.created_at or timezone.now()
    ticket.first_due_at = hours.add_business_minutes(c, start, int(targets.get("first", 480)))
    ticket.resolve_due_at = hours.add_business_minutes(c, start, int(targets.get("resolve", 2880)))


def sla_state(ticket, now=None):
    """ok, at_risk, breached, paused (waiting for the customer) or done."""
    now = now or timezone.now()
    if ticket.status in ("solved", "closed"):
        return "done"
    if ticket.status == "waiting_customer":
        return "paused"
    due = ticket.first_due_at if ticket.first_response_at is None else ticket.resolve_due_at
    if due is None:
        return "ok"
    if now > due:
        return "breached"
    return "at_risk" if due - now < timedelta(hours=2) else "ok"


# ================================================================ tickets
def author_name(user):
    return (user.full_name or user.email) if user else ""


def staff_name(user):
    return (user.full_name or "Support") if user else ""


def add_message(ticket, author_kind, user, body, internal=False, kind="message", status_to="", via="web", uploads=None,
                email_message_id="", name=""):
    """Add one entry to the conversation. `uploads` is a list of already validated (upload, (data, type)) pairs."""
    msg = SupportMessage.objects.create(
        ticket=ticket, author=user, author_kind=author_kind,
        author_name=(name or (staff_name(user) if author_kind == "staff" else author_name(user) if author_kind == "customer" else ""))[:120],
        kind=kind, body=body, internal=internal, via=via, status_to=status_to, email_message_id=email_message_id[:300],
    )
    for upload, checked in uploads or []:
        store_attachment(upload, author_kind, ticket=ticket, message=msg, checked=checked)
    if kind == "message" and not internal:
        ticket.last_message_at = msg.created_at
        ticket.last_author_kind = author_kind
        fields = ["last_message_at", "last_author_kind", "updated_at"]
        if author_kind == "staff" and ticket.first_response_at is None:
            ticket.first_response_at = msg.created_at
            fields.append("first_response_at")
        ticket.save(update_fields=fields)
    return msg


def set_status(ticket, status, actor_kind, user=None, note="", via="web"):
    """Move a ticket to a status; the move is also written in the conversation. Returns the previous status."""
    previous = ticket.status
    if previous == status:
        return previous
    now = timezone.now()
    ticket.status = status
    fields = ["status", "updated_at"]
    if previous == "waiting_customer" and ticket.sla_paused_at and ticket.resolve_due_at:
        pause = hours.business_minutes_between(cfg(), ticket.sla_paused_at, now)
        ticket.resolve_due_at = hours.add_business_minutes(cfg(), ticket.resolve_due_at, pause)
        ticket.sla_paused_at = None
        fields += ["resolve_due_at", "sla_paused_at"]
    if status == "waiting_customer":
        ticket.sla_paused_at = now
        fields.append("sla_paused_at")
    if status == "solved":
        ticket.solved_at = now
        fields.append("solved_at")
    if status == "closed":
        ticket.closed_at = now
        if ticket.solved_at is None:
            ticket.solved_at = now
            fields.append("solved_at")
        fields.append("closed_at")
    if previous in ("solved", "closed") and status in OPEN_STATUSES:
        ticket.closed_at = None
        ticket.solved_at = None
        ticket.sla_alerted_at = None
        fields += ["closed_at", "solved_at", "sla_alerted_at"]
    ticket.save(update_fields=list(dict.fromkeys(fields)))
    add_message(ticket, actor_kind if actor_kind in ("customer", "staff") else "system", user, note, kind="status", status_to=status, via=via)
    return previous


def create_ticket(*, user, email, name, subject, body, category="other", priority="normal", channel="form", workspace=None,
                  context=None, language="en", ip_hash="", uploads=None, via="web", email_message_id="", offline_reply=False,
                  notify=True):
    """Make a ticket with its first message, deadlines and the e-mails (confirmation to the customer, heads-up to staff)."""
    with transaction.atomic():
        ticket = SupportTicket(
            number=next_number(), requester=user, requester_email=(email or "").strip()[:254].lower(),
            requester_name=(name or "")[:120], language=language_or_default(language), workspace=workspace,
            subject=subject, category=category, priority=priority, status="new", channel=channel,
            context=context or {}, ip_hash=ip_hash,
        )
        ticket.created_at = timezone.now()
        set_due_times(ticket)
        ticket.save()
        add_message(ticket, "customer", user, body, via=via, uploads=uploads, email_message_id=email_message_id, name=name if not user else "")
    if notify:
        run_after_response(notify_created, ticket.pk, offline_reply)
    return ticket


# ================================================================ e-mail
def mail_domain():
    for source in (settings.SUPPORT_REPLY_TO, settings.DEFAULT_FROM_EMAIL):
        match = re.search(r"@([A-Za-z0-9.-]+)", source or "")
        if match:
            return match.group(1)
    return "support.invalid"


def root_message_id(ticket):
    return f"<support.{ticket.number}.{ticket.id.hex}@{mail_domain()}>"


def new_message_id(ticket):
    return f"<support.{ticket.number}.{secrets.token_hex(8)}@{mail_domain()}>"


def customer_url(ticket):
    return f"{settings.WEB_BASE_URL}/app/support/{ticket.id}"


def staff_url(ticket):
    return f"{settings.WEB_BASE_URL}/staff/support/{ticket.id}"


def ticket_lang(ticket):
    return language_or_default(ticket.language) if ticket.language else (user_language(ticket.requester) if ticket.requester else "en")


def _mail(to, lang, subject, heading, lines, ticket, button=None, url=None, raw=(), reply_marker=False, automatic=True,
          message=None, subject_prefix=True):
    """Send one branded support e-mail with the ticket token in the subject, Reply-To and threading headers."""
    marker = [REPLY_MARKER_AR if lang == "ar" else REPLY_MARKER_EN] if reply_marker else []
    paragraphs = list(lines) + list(raw)
    body_html = "".join(
        f'<p style="margin:0 0 16px;font-size:15px;line-height:{1.9 if lang == "ar" else 1.6};color:{settings.BRAND_BLACK};'
        f'white-space:pre-wrap;">{escape(p)}</p>' for p in paragraphs
    )
    if marker:
        body_html = f'<p style="margin:0 0 16px;font-size:11px;color:{settings.BRAND_MUTED};">{escape(marker[0])}</p>' + body_html
    if button and url:
        body_html += (
            f'<p style="margin:24px 0;"><a href="{escape(url, quote=True)}" style="display:inline-block;'
            f'background:{settings.BRAND_ORANGE};color:{settings.BRAND_BLACK};text-decoration:none;font-weight:700;'
            f'font-size:15px;padding:13px 26px;border-radius:999px;">{escape(button)}</a></p>'
        )
    footer = f'<p style="margin:0 0 8px;font-size:12px;color:{settings.BRAND_MUTED};">{escape(ticket.label)}</p>'
    html = brand_html_page(heading, body_html, footer_html=footer, lang=lang)
    text = "\n\n".join(marker + [heading] + paragraphs + ([f"{button}: {url}"] if button and url else []) + [ticket.label])
    msg_id = new_message_id(ticket)
    headers = {"Message-ID": msg_id, "References": root_message_id(ticket), "In-Reply-To": root_message_id(ticket)}
    if settings.SUPPORT_REPLY_TO:
        headers["Reply-To"] = settings.SUPPORT_REPLY_TO
    if automatic:
        headers["Auto-Submitted"] = "auto-generated"
        headers["X-Auto-Response-Suppress"] = "All"
    full_subject = f"[{ticket.label}] {subject}" if subject_prefix else subject
    try:
        send_brand_html(to, full_subject, text, html, headers=headers)
    except Exception:  # a mail server hiccup must not fail the request; the message stays in the ticket
        return ""
    if message is not None:
        SupportMessage.objects.filter(pk=message.pk).update(email_message_id=msg_id)
    return msg_id


def staff_recipients(ticket=None):
    from accounts.models import User

    if ticket is not None and ticket.assigned_staff and ticket.assigned_staff.is_active:
        return [ticket.assigned_staff.email]
    addresses = list(User.objects.filter(staff_role__in=("support", "admin"), is_active=True, deleted_at__isnull=True).values_list("email", flat=True))
    return list(dict.fromkeys(a for a in addresses if a))


def admin_recipients():
    from accounts.models import User

    addresses = list(User.objects.filter(staff_role="admin", is_active=True, deleted_at__isnull=True).values_list("email", flat=True))
    addresses += list(getattr(settings, "SUPPORT_ALERT_EMAILS", []) or [])
    return list(dict.fromkeys(a for a in addresses if a))


def snippet(text, limit=300):
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def notify_created(ticket_id, offline_reply=False):
    ticket = SupportTicket.objects.filter(pk=ticket_id).first()
    if ticket is None:
        return
    c = cfg()
    lang = ticket_lang(ticket)
    reply = (c.offline_reply_ar if lang == "ar" else c.offline_reply_en) if offline_reply else (c.auto_reply_ar if lang == "ar" else c.auto_reply_en)
    lines = [tr(lang, "We received your request {ticket}.", ticket=ticket.label)]
    if reply:
        lines.append(reply)
    if ticket.requester_id is None:
        lines.append(tr(lang, "Reply to this e-mail to add more details."))
    _mail(
        ticket.requester_email, lang, tr(lang, "We received your request"), tr(lang, "We received your request"), lines, ticket,
        button=tr(lang, "Open your request") if ticket.requester_id else None, url=customer_url(ticket),
    )
    for address in staff_recipients(ticket):
        slang = language_for_email(address)
        _mail(
            address, slang, tr(slang, "New support request: {subject}", subject=ticket.subject), tr(slang, "New support request"),
            [tr(slang, "{ticket} from {name}: {subject}", ticket=ticket.label, name=ticket.requester_name or ticket.requester_email, subject=ticket.subject)],
            ticket, button=tr(slang, "Open in the staff area"), url=staff_url(ticket), raw=[snippet(ticket.messages.first().body if ticket.messages.exists() else "")],
            subject_prefix=True,
        )


def notify_customer_replied(ticket_id, message_id):
    ticket = SupportTicket.objects.filter(pk=ticket_id).first()
    msg = SupportMessage.objects.filter(pk=message_id).first()
    if ticket is None or msg is None:
        return
    for address in staff_recipients(ticket):
        lang = language_for_email(address)
        _mail(
            address, lang, tr(lang, "New reply on: {subject}", subject=ticket.subject), tr(lang, "The customer replied"),
            [tr(lang, "{ticket} has a new reply.", ticket=ticket.label)], ticket, button=tr(lang, "Open in the staff area"),
            url=staff_url(ticket), raw=[snippet(msg.body)],
        )


def notify_staff_replied(ticket_id, message_id):
    ticket = SupportTicket.objects.filter(pk=ticket_id).first()
    msg = SupportMessage.objects.filter(pk=message_id).first()
    if ticket is None or msg is None or msg.internal:
        return
    lang = ticket_lang(ticket)
    lines = [tr(lang, "{agent} from our team replied to your request {ticket}:", agent=msg.author_name or tr(lang, "Our support team"), ticket=ticket.label)]
    tail = [tr(lang, "Reply to this e-mail to answer.")]
    _mail(
        ticket.requester_email, lang, ticket.subject, tr(lang, "We replied to your request"), lines, ticket,
        button=tr(lang, "Open your request") if ticket.requester_id else None, url=customer_url(ticket),
        raw=[snippet(msg.body, 600)] + tail, reply_marker=True, automatic=False, message=msg,
    )
    try:
        from notify.services import notify_support_reply

        notify_support_reply(ticket)
    except Exception:  # a push problem must never stop the reply
        pass


def notify_status(ticket_id, status):
    ticket = SupportTicket.objects.filter(pk=ticket_id).first()
    if ticket is None or status not in ("solved", "closed"):
        return
    lang = ticket_lang(ticket)
    if status == "solved":
        heading = tr(lang, "Your request was marked as solved")
        lines = [tr(lang, "We marked {ticket} as solved. If it is not, reply within {days} days and we will reopen it.", ticket=ticket.label, days=REOPEN_DAYS)]
    else:
        heading = tr(lang, "Your request was closed")
        lines = [tr(lang, "We closed {ticket}. Start a new request any time if you need more help.", ticket=ticket.label)]
    _mail(ticket.requester_email, lang, heading, heading, lines, ticket,
          button=tr(lang, "Open your request") if ticket.requester_id else None, url=customer_url(ticket))


def notify_sla_breach(ticket):
    for address in admin_recipients():
        lang = language_for_email(address)
        which = tr(lang, "first reply") if ticket.first_response_at is None else tr(lang, "resolution")
        _mail(
            address, lang, tr(lang, "SLA missed: {subject}", subject=ticket.subject), tr(lang, "A support deadline was missed"),
            [tr(lang, "{ticket} missed its {which} deadline.", ticket=ticket.label, which=which)], ticket,
            button=tr(lang, "Open in the staff area"), url=staff_url(ticket),
        )


# ================================================================ canned replies
def render_canned(reply, ticket, agent):
    body = reply.body_ar if ticket_lang(ticket) == "ar" and reply.body_ar.strip() else reply.body_en
    values = {
        "{name}": ticket.requester_name or (ticket.requester.full_name if ticket.requester else "") or "",
        "{ticket}": ticket.label, "{agent}": staff_name(agent), "{product}": settings.PRODUCT_NAME,
    }
    for key, value in values.items():
        body = body.replace(key, value)
    return body


# ================================================================ JSON
def unread_for_customer(ticket):
    qs = ticket.messages.filter(internal=False, kind="message", author_kind="staff")
    if ticket.customer_seen_at:
        qs = qs.filter(created_at__gt=ticket.customer_seen_at)
    return qs.count()


def can_reopen(ticket, now=None):
    now = now or timezone.now()
    return ticket.status == "solved" and ticket.solved_at is not None and now < ticket.solved_at + timedelta(days=REOPEN_DAYS)


def message_json(m, staff=False):
    out = {
        "id": str(m.id), "author": m.author_kind, "author_name": m.author_name, "kind": m.kind, "body": m.body,
        "via": m.via, "status_to": m.status_to, "created_at": iso(m.created_at),
        "files": [attachment_json(a) for a in m.attachments.all()],
    }
    if staff:
        out["internal"] = m.internal
    return out


def ticket_json(t, staff=False, unread=None):
    out = {
        "id": str(t.id), "number": t.number, "label": t.label, "subject": t.subject, "category": t.category, "status": t.status,
        "channel": t.channel, "created_at": iso(t.created_at), "updated_at": iso(t.updated_at), "last_message_at": iso(t.last_message_at),
        "last_author": t.last_author_kind, "solved_at": iso(t.solved_at), "rating": t.rating,
        "workspace_id": str(t.workspace_id) if t.workspace_id else None,
    }
    if staff:
        out.update({
            "priority": t.priority, "requester_email": t.requester_email, "requester_name": t.requester_name,
            "requester_id": str(t.requester_id) if t.requester_id else None, "language": t.language,
            "assigned_to": str(t.assigned_staff_id) if t.assigned_staff_id else None,
            "assigned_name": staff_name(t.assigned_staff) if t.assigned_staff_id else "",
            "workspace_name": t.workspace.name if t.workspace_id else "", "sla": sla_state(t),
            "first_due_at": iso(t.first_due_at), "resolve_due_at": iso(t.resolve_due_at),
            "first_response_at": iso(t.first_response_at), "spam": t.spam,
            "merged_into": t.merged_into.label if t.merged_into_id else None,
        })
    else:
        out["unread"] = unread if unread is not None else unread_for_customer(t)
        out["can_reopen"] = can_reopen(t)
    return out


def ticket_detail_json(t, staff=False):
    out = ticket_json(t, staff=staff)
    qs = t.messages.prefetch_related("attachments")
    if not staff:
        qs = qs.filter(internal=False)
    out["messages"] = [message_json(m, staff=staff) for m in qs]
    out["context"] = t.context
    out["rating_comment"] = t.rating_comment
    chat = t.chats.filter(status="active").order_by("-started_at").first()
    out["active_chat_id"] = str(chat.id) if chat else None
    if not staff:
        out["reopen_until"] = iso(t.solved_at + timedelta(days=REOPEN_DAYS)) if t.status == "solved" and t.solved_at else None
    return out


def ip_digest(value):
    return hashlib.sha256(f"{value}|{settings.SECRET_KEY}".encode("utf-8")).hexdigest()[:32]


def sweep_sla(now=None):
    """Alert the admins once for every open ticket whose deadline has passed. Returns how many alerts went out."""
    now = now or timezone.now()
    sent = 0
    qs = SupportTicket.objects.filter(status__in=("new", "open"), sla_alerted_at__isnull=True)
    for ticket in qs.filter(first_response_at__isnull=True, first_due_at__lt=now) | qs.filter(first_response_at__isnull=False, resolve_due_at__lt=now):
        ticket.sla_alerted_at = now
        ticket.save(update_fields=["sla_alerted_at"])
        notify_sla_breach(ticket)
        sent += 1
    return sent


def close_old_solved(now=None):
    """Close tickets that were solved more than REOPEN_DAYS ago."""
    now = now or timezone.now()
    count = 0
    for ticket in SupportTicket.objects.filter(status="solved", solved_at__lt=now - timedelta(days=REOPEN_DAYS)):
        set_status(ticket, "closed", "system", note="")
        count += 1
    return count


def open_chat_for(user=None, ip_hash=""):
    qs = ChatSession.objects.filter(status__in=("waiting", "active"))
    if user is not None:
        return qs.filter(user=user).first()
    return qs.filter(ip_hash=ip_hash, user__isnull=True).first() if ip_hash else None
