"""Inbound e-mail: read a message, ignore robots and loops, strip quoted replies and signatures, then add it to the
right ticket (found by the ticket number in the subject or by the Message-ID headers) or open a new ticket."""
import base64
import hashlib
import re
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr
from html import unescape

from django.conf import settings
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.utils import timezone

from ilaf.errors import ApiError

from . import services
from .models import InboundMail, SupportMessage, SupportTicket

MAX_TEXT = 20000
MAX_ATTACHMENTS = services.MAX_FILES_PER_MESSAGE
SENDER_PER_HOUR = 30
EMAIL_RE = re.compile(r"^[^@\s<>]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$")

# Lines that start the quoted part of a reply, in English and Arabic.
_CUT_LINE = [re.compile(p, re.I) for p in (
    r"^\s*##-.*-##\s*$",
    r"^\s*-{2,}\s*(original message|forwarded message|الرسالة الأصلية)\s*-{2,}\s*$",
    r"^\s*_{8,}\s*$",
    r"^--\s?$",
    r"^\s*sent from my .{1,40}$",
    r"^\s*get outlook for .{1,30}$",
    r"^\s*أُرسل من .{1,40}$",
    r"^\s*أرسل من .{1,40}$",
)]
_WROTE = re.compile(r"^\s*(on .{6,240}wrote:|le .{6,240}a écrit\s*:|.{0,240}(كتب|كتبت)\s*:|.{0,240}wrote:)\s*$", re.I)
_HEADER_BLOCK_START = re.compile(r"^\s*(from|de|von|من)\s*:\s*\S", re.I)
_HEADER_BLOCK_NEXT = re.compile(r"^\s*(sent|date|to|subject|cc|أرسل|التاريخ|إلى|الموضوع)\s*:", re.I)

_AUTO_SUBJECT = re.compile(
    r"^\s*(auto(matic)?[- ]?(reply|response)|out of office|undeliverable|delivery status notification|mail delivery failed|"
    r"returned mail|رد تلقائي|خارج المكتب|فشل التسليم)", re.I,
)
_AUTO_SENDER = re.compile(r"^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce[s]?|notifications?)@", re.I)


def sender_address(value):
    addr = parseaddr(value or "")[1].strip().lower()
    return addr if EMAIL_RE.match(addr) else ""


def sender_name(value):
    return parseaddr(value or "")[0].strip()[:120]


def own_addresses():
    out = set()
    for raw in (settings.SUPPORT_REPLY_TO, settings.DEFAULT_FROM_EMAIL, settings.SUPPORT_IMAP_USER, services.cfg().inbound_address):
        addr = sender_address(raw)
        if addr:
            out.add(addr)
    return out


def is_automatic(headers, sender, subject):
    """True for auto-replies, bounces, bulk mail and our own mail coming back: they must never open or change a ticket."""
    h = {str(k).lower(): str(v).strip().lower() for k, v in (headers or {}).items()}
    if h.get("auto-submitted", "no") not in ("", "no"):
        return True
    if h.get("precedence", "") in ("bulk", "junk", "list", "auto_reply", "auto-reply"):
        return True
    if "x-auto-response-suppress" in h or "list-id" in h or "x-autoreply" in h or "x-autorespond" in h:
        return True
    if h.get("x-failed-recipients") or h.get("return-path") == "<>":
        return True
    if _AUTO_SENDER.match(sender or "") or sender in own_addresses():
        return True
    return bool(_AUTO_SUBJECT.match(subject or ""))


def strip_quoted(text):
    """The new part of a reply: everything above the first quote marker, signature delimiter or quoted header block."""
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    keep = []
    for i, line in enumerate(lines):
        if any(p.match(line) for p in _CUT_LINE):
            break
        if _WROTE.match(line) or (i + 1 < len(lines) and line.strip() and _WROTE.match(line + " " + lines[i + 1].strip()) and len(line) < 200 and re.match(r"^\s*(on|le)\b", line, re.I)):
            break
        if _HEADER_BLOCK_START.match(line) and any(_HEADER_BLOCK_NEXT.match(x) for x in lines[i + 1: i + 5]):
            break
        if line.lstrip().startswith(">"):
            continue
        keep.append(line)
    return "\n".join(keep).strip()


def html_to_text(html):
    html = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", "", html or "")
    html = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</li>", "\n", html)
    html = re.sub(r"(?is)<blockquote.*?</blockquote>", "", html)
    return unescape(re.sub(r"<[^>]+>", "", html))


def clean_subject_text(subject):
    subject = " ".join(str(subject or "").split())
    token = re.compile(r"\[?\b%s-\d{3,8}\b\]?" % re.escape(settings.SUPPORT_TICKET_PREFIX), re.I)
    subject = token.sub("", subject)
    while True:
        new = re.sub(r"^\s*(re|fwd?|aw|sv|رد|إعادة توجيه)\s*:\s*", "", subject, flags=re.I)
        if new == subject:
            break
        subject = new
    return subject.strip(" -:")[:200]


def looks_arabic(text):
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    arabic = sum(1 for c in letters if "؀" <= c <= "ۿ")
    return arabic / len(letters) > 0.3


def find_ticket(subject, in_reply_to, references, to_address):
    """The ticket a mail belongs to: the number in the subject, the number in a ticket address, or the Message-ID headers."""
    prefix = re.escape(settings.SUPPORT_TICKET_PREFIX)
    numbers = []
    for source in (subject or "", to_address or ""):
        numbers += [int(n) for n in re.findall(r"\b%s[-+_]?(\d{3,8})\b" % prefix, source, flags=re.I)]
    ids = [x for x in re.findall(r"<[^<>\s]{3,290}>", f"{in_reply_to or ''} {references or ''}")]
    for mid in ids:
        match = re.match(r"<support\.(\d+)\.", mid)
        if match:
            numbers.append(int(match.group(1)))
    for number in numbers:
        ticket = SupportTicket.objects.filter(number=number).first()
        if ticket:
            return ticket
    if ids:
        row = SupportMessage.objects.filter(email_message_id__in=ids).select_related("ticket").first()
        if row:
            return row.ticket
    return None


def _uploads(attachments, notes):
    """Validate attachments of a mail; returns (uploads for the message, notes about files that were not taken)."""
    picked = []
    for item in attachments or []:
        name = services.clean_filename(item.get("filename") or "file")
        content = item.get("content")
        if content is None and item.get("content_base64"):
            try:
                content = base64.b64decode(item["content_base64"], validate=False)
            except Exception:
                content = None
        if not content:
            notes.append(name)
            continue
        if len(picked) >= MAX_ATTACHMENTS:
            notes.append(name)
            continue
        upload = SimpleUploadedFile(name, content)
        try:
            checked = services.check_upload(upload)
        except ApiError:
            notes.append(name)
            continue
        except Exception:
            notes.append(name)
            continue
        picked.append((upload, checked))
    return picked


def process_inbound(data):
    """Handle one received mail (a dict with from, to, subject, text, html, message_id, in_reply_to, references, headers,
    attachments). Returns {"status": ignored|created|added|reopened, "ticket": label|None, "reason": ...}."""
    sender = sender_address(data.get("from"))
    subject = str(data.get("subject") or "")[:500]
    if not sender:
        return {"status": "ignored", "reason": "no_sender", "ticket": None}
    if is_automatic(data.get("headers"), sender, subject):
        return {"status": "ignored", "reason": "automatic", "ticket": None}
    text = str(data.get("text") or "")
    if not text.strip() and data.get("html"):
        text = html_to_text(str(data.get("html"))[:400000])
    body = strip_quoted(text[:200000])[:MAX_TEXT]
    uploads_notes = []
    uploads = _uploads(data.get("attachments"), uploads_notes)
    if not body and not uploads:
        return {"status": "ignored", "reason": "empty", "ticket": None}
    if uploads_notes:
        body += "\n\n" + "\n".join(f"(attachment not imported: {n})" for n in uploads_notes)
    # a sender may add only so many mails an hour; a mail seen before is dropped
    key = "support:inbound:" + hashlib.sha256(sender.encode()).hexdigest()[:16]
    cache.add(key, 0, 3600)
    try:
        if cache.incr(key) > SENDER_PER_HOUR:
            return {"status": "ignored", "reason": "rate_limited", "ticket": None}
    except ValueError:
        pass
    message_id = str(data.get("message_id") or "").strip()[:300] or "hash:" + hashlib.sha256(f"{sender}|{subject}|{body}".encode()).hexdigest()
    try:
        with transaction.atomic():
            InboundMail.objects.create(message_id=message_id)
    except IntegrityError:
        return {"status": "ignored", "reason": "duplicate", "ticket": None}

    ticket = find_ticket(subject, data.get("in_reply_to"), data.get("references"), str(data.get("to") or ""))
    while ticket is not None and ticket.merged_into_id:
        ticket = ticket.merged_into
    if ticket is not None and sender in {ticket.requester_email.lower(), (ticket.requester.email.lower() if ticket.requester else "")}:
        return _add_reply(ticket, body, uploads, message_id, data)
    if ticket is not None:
        body = f"(Reply to {ticket.label} from a different address.)\n\n" + body
    return _new_ticket(sender, data, subject, body, uploads, message_id)


def _add_reply(ticket, body, uploads, message_id, data):
    status = "added"
    if ticket.status == "closed" or (ticket.status == "solved" and not services.can_reopen(ticket)):
        new = _new_ticket(ticket.requester_email, data, "Re: " + ticket.subject, f"(Follow-up to {ticket.label}.)\n\n" + body, uploads, message_id, user=ticket.requester)
        return new
    msg = services.add_message(ticket, "customer", ticket.requester, body, via="email", uploads=uploads, email_message_id=message_id, name=ticket.requester_name)
    if ticket.status in ("waiting_customer", "solved"):
        if ticket.status == "solved":
            status = "reopened"
        services.set_status(ticket, "open", "customer", ticket.requester, via="email")
    from ilaf.utils import run_after_response

    run_after_response(services.notify_customer_replied, ticket.pk, msg.pk)
    return {"status": status, "ticket": ticket.label, "reason": ""}


def _new_ticket(sender, data, subject, body, uploads, message_id, user=None):
    from accounts.models import User

    if user is None:
        user = User.objects.filter(email__iexact=sender, email_verified=True, is_active=True, deleted_at__isnull=True).first()
    clean = clean_subject_text(subject) or "(no subject)"
    lang = "ar" if looks_arabic(body + clean) else "en"
    if user is not None and user.language in ("ar", "en"):
        lang = user.language
    ticket = services.create_ticket(
        user=user, email=sender, name=sender_name(data.get("from")) or (user.full_name if user else ""), subject=clean, body=body or "(attachment)",
        category="other", channel="email", language=lang, uploads=uploads, via="email", email_message_id=message_id,
    )
    return {"status": "created", "ticket": ticket.label, "reason": ""}


# ================================================================ reading a raw mail (IMAP)
def parse_raw(raw):
    """A dict for `process_inbound` from the bytes of a mail. Attachments are kept only when small enough to be accepted."""
    msg = BytesParser(policy=policy.default).parsebytes(raw)
    text = html = ""
    attachments = []
    for part in msg.walk():
        if part.is_multipart():
            continue
        ctype = part.get_content_type()
        disposition = (part.get_content_disposition() or "").lower()
        try:
            if disposition == "attachment" or part.get_filename():
                content = part.get_payload(decode=True) or b""
                if len(content) <= services.MAX_FILE_BYTES and len(attachments) < 20:
                    attachments.append({"filename": part.get_filename() or "file", "content_type": ctype, "content": content})
                continue
            if ctype == "text/plain" and not text:
                text = part.get_content()
            elif ctype == "text/html" and not html:
                html = part.get_content()
        except Exception:
            continue
    headers = {k: str(v) for k, v in msg.items() if k.lower() in (
        "auto-submitted", "precedence", "x-auto-response-suppress", "list-id", "x-autoreply", "x-autorespond", "x-failed-recipients", "return-path")}
    return {
        "from": str(msg.get("From", "")), "to": str(msg.get("To", "")), "subject": str(msg.get("Subject", "")), "text": text, "html": html,
        "message_id": str(msg.get("Message-ID", "")).strip(), "in_reply_to": str(msg.get("In-Reply-To", "")),
        "references": str(msg.get("References", "")), "headers": headers, "attachments": attachments,
    }
