"""Public lead intake: field rules, spam checks, saving and the e-mail to the card owner.

Spam checks, in order: the hidden honeypot field (a bot fills it), a minimum time between the form
being opened and sent (`opened_at`, milliseconds since 1970, set by the page), and a cap on leads from
one address for one card per hour. The cap and the minimum time come from settings so tests and
busy events can change them.
"""
import time
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from cards.features import exchange_settings
from ilaf.emails import send_brand_email
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import language_for_email, tr
from ilaf.utils import clean_line, clean_multiline, client_ip
from workspaces.models import Member
from workspaces.sharing import card_shares_with_company

from . import workflow
from .models import Lead

CHANNELS = ("nfc", "qr", "link", "email")
EMAIL_OK = serializers.EmailField()
MAX_TIMES = 3
MAX_TIME_LEN = 80


def _text(data, name, max_len, errors, multiline=False):
    raw = data.get(name)
    if raw is None:
        return ""
    if not isinstance(raw, str):
        errors[name] = ["Must be text."]
        return ""
    try:
        return clean_multiline(raw, max_len) if multiline else clean_line(raw, max_len)
    except ValidationError as exc:
        errors[name] = [str(m) for m in exc.detail]
        return ""


def is_honeypot(data):
    """Real visitors never see this field. A filled one means a bot."""
    return bool(str(data.get("website_url") or "").strip())


def check_not_too_fast(data):
    """The form must have been open for a few seconds, and not for longer than a day."""
    minimum = getattr(settings, "LEAD_MIN_FILL_SECONDS", 3)
    if minimum <= 0:
        return
    try:
        opened = float(data.get("opened_at"))
    except (TypeError, ValueError):
        raise ApiError("too_fast", "Please take a moment to fill in the form and try again.", 400)
    age = time.time() - opened / 1000.0
    if age < minimum or age > 86400:
        raise ApiError("too_fast", "Please take a moment to fill in the form and try again.", 400)


def _limit_key(card, request):
    return f"lead-cap:{card.id}:{client_ip(request)}"


def check_card_cap(card, request):
    cap = getattr(settings, "LEAD_MAX_PER_CARD_PER_HOUR", 5)
    if cap > 0 and cache.get(_limit_key(card, request), 0) >= cap:
        raise ApiError("throttled", "You have sent several messages already. Please try again later.", 429)
    # Whoever the visitor is, one card cannot be flooded: a daily ceiling on all leads for that card.
    daily = getattr(settings, "LEAD_MAX_PER_CARD_PER_DAY", 300)
    if daily > 0 and Lead.objects.filter(card=card, created_at__gte=timezone.now() - timedelta(days=1)).count() >= daily:
        raise ApiError("throttled", "This card cannot take more messages today. Please try again tomorrow.", 429)


def count_for_cap(card, request):
    key = _limit_key(card, request)
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, 3600)


def check_consent(data):
    if data.get("consent") is not True:
        raise validation_error({"consent": ["Please tick the box to agree."]})


def _channel(data):
    value = str(data.get("source") or "")
    return value if value in CHANNELS else ""


def clean_exchange(card, data):
    """Validate an exchange submission against the card's field settings. Returns the lead fields."""
    ex = exchange_settings(card)
    modes = ex["fields"]
    errors = {}
    name = _text(data, "name", 120, errors)
    email = _text(data, "email", 254, errors) if modes["email"] != "off" else ""
    phone = _text(data, "phone", 40, errors) if modes["phone"] != "off" else ""
    company = _text(data, "company", 120, errors) if modes["company"] != "off" else ""
    note = _text(data, "note", 2000, errors, multiline=True) if modes["note"] != "off" else ""
    if not name and "name" not in errors:
        errors["name"] = ["Enter your name."]
    if email:
        try:
            EMAIL_OK.run_validation(email)
        except ValidationError:
            errors["email"] = ["Enter a valid email address."]
    for key, value in (("email", email), ("phone", phone), ("company", company), ("note", note)):
        if modes[key] == "required" and not value and key not in errors:
            errors[key] = [f"Please fill in your {'message' if key == 'note' else key}."]
    if (
        modes["email"] == "optional" and modes["phone"] == "optional" and not email and not phone
        and "email" not in errors and "phone" not in errors
    ):
        errors["email"] = ["Enter an email address or a phone number."]
    if errors:
        raise validation_error(errors)
    return {"name": name, "email": email, "phone": phone, "company": company, "note": note}


def clean_meeting(data):
    """Validate a meeting request: name, e-mail, 1 to 3 preferred times, optional message."""
    errors = {}
    name = _text(data, "name", 120, errors)
    email = _text(data, "email", 254, errors)
    message = _text(data, "message", 1000, errors, multiline=True)
    phone = _text(data, "phone", 40, errors)
    if not name and "name" not in errors:
        errors["name"] = ["Enter your name."]
    if not email and "email" not in errors:
        errors["email"] = ["Enter your email address."]
    elif email:
        try:
            EMAIL_OK.run_validation(email)
        except ValidationError:
            errors["email"] = ["Enter a valid email address."]
    raw_times = data.get("times")
    times = []
    if not isinstance(raw_times, list):
        errors["times"] = ["Add at least one time that suits you."]
    else:
        for item in raw_times:
            if not isinstance(item, str):
                errors["times"] = ["Each time must be text."]
                break
            try:
                value = clean_line(item, MAX_TIME_LEN)
            except ValidationError as exc:
                errors["times"] = [str(m) for m in exc.detail]
                break
            if value:
                times.append(value)
        if "times" not in errors:
            if not times:
                errors["times"] = ["Add at least one time that suits you."]
            elif len(times) > MAX_TIMES:
                errors["times"] = [f"Suggest up to {MAX_TIMES} times."]
    if errors:
        raise validation_error(errors)
    return {"name": name, "email": email, "phone": phone, "note": message, "meeting_times": times}


def card_recipients(card, lead=None):
    """E-mail addresses told about a new lead: the card's holder. Company admins are told only about the company's own card (when the
    company asks), about a lead the holder shared (`lead.shared_with_company`), or when a card has no holder; they are never told about
    the other contacts of an employee's card."""
    found = []
    if card.owner_id and card.owner.email:
        found.append(card.owner.email)
    elif card.member_id and card.member.email:
        found.append(card.member.email)
    ws = card.workspace
    notify_admins = bool((ws.lead_settings or {}).get("notify_admins")) and ws.kind == "company" and (card.is_company or bool(lead is not None and lead.shared_with_company))
    if notify_admins or not found:
        if ws.kind == "company":
            admins = Member.objects.filter(workspace=ws, role__in=("owner", "admin"), status="active").exclude(email="")
            found.extend(m.email for m in admins)
    seen, out = set(), []
    for address in found:
        if address.lower() not in seen:
            seen.add(address.lower())
            out.append(address)
    return out


def _subject_name(name):
    """A visitor's name as it may appear in an e-mail subject. The name is typed by a stranger, so anything that looks
    like a link or an address, and anything long, is replaced: the subject must not carry an attacker's message."""
    name = " ".join((name or "").split())
    lowered = name.lower()
    if not name or "://" in lowered or "@" in name or "www." in lowered or any(t in lowered for t in (".com", ".net", ".org", ".ru", ".xyz")):
        return tr_visitor()
    return name[:40]


def tr_visitor():
    return "A visitor"


def _recipient_has_room(address):
    """At most LEAD_NOTIFY_MAX_PER_RECIPIENT_PER_DAY lead e-mails go to one address per day, so the form cannot be
    used to bury someone in mail from this domain. The leads themselves are still saved."""
    cap = getattr(settings, "LEAD_NOTIFY_MAX_PER_RECIPIENT_PER_DAY", 100)
    if cap <= 0:
        return True
    key = f"lead-mail:{address.lower()}:{timezone.now().strftime('%Y%m%d')}"
    cache.add(key, 0, 86400)
    try:
        return cache.incr(key) <= cap
    except ValueError:
        cache.set(key, 1, 86400)
        return True


def notify_lead(card, lead):
    """E-mail the lead's details to the card's holder (and company admins when enabled). Never raises."""
    sent = 0
    try:
        for address in card_recipients(card, lead):
            if not _recipient_has_room(address):
                continue
            lang = language_for_email(address)
            if lead.source == "meeting_request":
                subject = tr(lang, "Meeting request from {name}", name=_subject_name(lead.name))
                heading = tr(lang, "{name} would like to meet", name=lead.name)
            else:
                subject = tr(lang, "{name} shared their details with you", name=_subject_name(lead.name))
                heading = tr(lang, "{name} shared their details", name=lead.name)
            lines = [
                tr(lang, "Card: {card}", card=card.name or tr(lang, "Your card")),
                tr(lang, "Name: {name}", name=lead.name),
            ]
            if lead.email:
                lines.append(tr(lang, "Email: {value}", value=lead.email))
            if lead.phone:
                lines.append(tr(lang, "Phone: {value}", value=lead.phone))
            if lead.company:
                lines.append(tr(lang, "Company: {value}", value=lead.company))
            if lead.meeting_times:
                lines.append(tr(lang, "Preferred times: {value}", value="; ".join(lead.meeting_times)))
            if lead.note:
                lines.append(tr(lang, "Message: {value}", value=lead.note))
            send_brand_email(
                address, subject, heading, lines,
                button_text=tr(lang, "Open your contacts"), button_url=f"{settings.WEB_BASE_URL}/app/contacts",
                lang=lang,
            )
            sent += 1
    except Exception:  # a mail problem must never lose the lead
        pass
    try:
        from notify.services import notify_new_lead

        notify_new_lead(card, lead, card_recipients(card, lead))  # the same people, in their browser (needs opt-in and VAPID keys)
    except Exception:
        pass
    return sent


def save_lead(card, source, fields, data, consent=True):
    lead = Lead.objects.create(
        card=card, workspace_id=card.workspace_id, card_name=(card.name or "")[:120], source=source,
        channel=_channel(data), consented_at=timezone.now() if consent else None,
        shared_with_company=card_shares_with_company(card), **fields,
    )
    try:
        workflow.note_created(lead)
    except Exception:  # the timeline and the webhook queue must never lose the lead
        pass
    sent = notify_lead(card, lead)
    try:
        workflow.note_emailed(lead, sent)
    except Exception:
        pass
    return lead
