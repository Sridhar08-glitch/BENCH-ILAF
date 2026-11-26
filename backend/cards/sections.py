"""Rich blocks under the card (sections): the kinds, how each kind's settings are checked, and how the public page sees them.

A section's `data` is checked per kind: unknown keys are refused, text is trimmed and capped, lists are bounded.
The stored data always holds every key of its kind (missing ones read as their defaults), so the web app never
has to guess. The public page gets only the switched-on sections, with team cards and gallery pictures expanded.
"""
import re
import zoneinfo
from datetime import timezone as dt_timezone
from urllib.parse import urlsplit

from django.core.exceptions import FieldError
from django.db.models import Q
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import ValidationError

from ilaf.errors import validation_error
from ilaf.utils import ANY_CONTROL_RE, clean_line, clean_multiline, file_url, iso

KINDS = ("video", "products", "hours", "booking", "team", "gallery", "event", "map")
MAX_SECTIONS = 8
MAX_PRODUCT_SECTIONS = 3
MAX_TEAM_CARDS = 12
MAX_GALLERY_IMAGES = 9
MAX_TITLE = 80
PRODUCT_LAYOUTS = ("grid", "carousel", "menu", "listings")
DEFAULT_TIMEZONE = "Asia/Qatar"
# Days run Monday (0) to Sunday (6), the same way the booking windows count them.
WEEK = range(7)
FRIDAY = 4
TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
MAX_URL = 500

_ZONES = None


def _zones():
    global _ZONES
    if _ZONES is None:
        _ZONES = zoneinfo.available_timezones()
    return _ZONES


def default_days():
    return [{"d": d, "open": "09:00", "close": "17:00", "closed": d == FRIDAY} for d in WEEK]


def default_data(kind):
    """Every key a section of this kind carries, with its default."""
    data = {"title": ""}
    if kind == "products":
        data["layout"] = "grid"
    elif kind == "hours":
        data.update(timezone=DEFAULT_TIMEZONE, days=default_days(), note="")
    elif kind == "team":
        data["cards"] = []
    elif kind == "event":
        data.update(
            event_name="", starts_at=None, ends_at=None, venue="", hall="", stand="", talk_title="", talk_time="",
            slides_url="",
        )
    elif kind == "map":
        data.update(address="", maps_url="", directions_note="")
    return data


# ---------------------------------------------------------------- field helpers
def _text(errors, merged, data, key, max_len, multiline=False):
    if key not in data:
        return
    value = data[key]
    if value is None:
        merged[key] = ""
        return
    if not isinstance(value, str):
        errors[key] = ["Must be text."]
        return
    try:
        merged[key] = clean_multiline(value, max_len) if multiline else clean_line(value, max_len)
    except ValidationError as exc:
        errors[key] = [str(m) for m in exc.detail]


def is_https_url(value):
    """A plain https address with a host that has a dot and no user name in it."""
    if not isinstance(value, str) or not value or len(value) > MAX_URL or ANY_CONTROL_RE.search(value) or " " in value:
        return False
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    return parts.scheme == "https" and "." in (parts.hostname or "") and not parts.username and not parts.password


def _https(errors, merged, data, key):
    if key not in data:
        return
    value = data[key]
    if value in (None, ""):
        merged[key] = ""
    elif is_https_url(value.strip() if isinstance(value, str) else value):
        merged[key] = value.strip()
    else:
        errors[key] = ["Enter an https web address."]


def _choice(errors, merged, data, key, choices):
    if key not in data:
        return
    if data[key] in choices:
        merged[key] = data[key]
    else:
        errors[key] = [f"Choose one of: {', '.join(choices)}."]


def _datetime(errors, merged, data, key, required):
    """An ISO 8601 date and time. A value without a zone counts as UTC. Stored as an ISO string in UTC."""
    if key not in data:
        return
    value = data[key]
    if value in (None, ""):
        if required:
            errors[key] = ["Enter a date and time, such as 2026-03-01T09:00:00Z."]
        else:
            merged[key] = None
        return
    parsed = parse_datetime(value) if isinstance(value, str) else None
    if parsed is None:
        errors[key] = ["Enter a date and time, such as 2026-03-01T09:00:00Z."]
        return
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt_timezone.utc)
    merged[key] = iso(parsed)


def _days(errors, merged, data):
    if "days" not in data:
        return
    raw = data["days"]
    message = "Send seven days, Monday to Sunday, each with open and close times."
    if not isinstance(raw, list) or len(raw) != 7 or not all(isinstance(d, dict) for d in raw):
        errors["days"] = [message]
        return
    days = {}
    for entry in raw:
        d = entry.get("d")
        if not (isinstance(d, int) and not isinstance(d, bool) and d in WEEK) or d in days:
            errors["days"] = [message]
            return
        closed = entry.get("closed", False)
        if not isinstance(closed, bool):
            errors["days"] = ["Must be true or false."]
            return
        times = {}
        for side in ("open", "close"):
            value = entry.get(side, "")
            if closed and value in (None, ""):
                times[side] = ""
                continue
            if not isinstance(value, str) or not TIME_RE.match(value):
                errors["days"] = ["Use the 24-hour form HH:MM, such as 09:00."]
                return
            times[side] = value
        days[d] = {"d": d, "open": times["open"], "close": times["close"], "closed": closed}
    merged["days"] = [days[d] for d in WEEK]


def _team_cards(errors, merged, data, card):
    if "cards" not in data:
        return
    raw = data["cards"]
    if not isinstance(raw, list) or not all(isinstance(c, str) for c in raw):
        errors["cards"] = ["Choose up to 12 team cards."]
        return
    codes = []
    for code in raw:
        if code not in codes:
            codes.append(code)
    if len(codes) > MAX_TEAM_CARDS:
        errors["cards"] = ["Choose up to 12 team cards."]
        return
    allowed = set(team_card_pool(card.workspace).filter(public_code__in=codes).values_list("public_code", flat=True))
    if any(code not in allowed for code in codes):
        errors["cards"] = ["Each team card must be a published card of your workspace that is not hidden from the directory."]
        return
    merged["cards"] = codes


def team_card_pool(workspace):
    """Cards a team section may show: the directory's rules (published, not hidden, seat active when there is one)."""
    from .models import Card

    return Card.objects.filter(workspace=workspace, status="published", hide_from_directory=False).filter(
        Q(member__isnull=True) | Q(member__status="active")
    )


# ---------------------------------------------------------------- the check
def clean_section_data(kind, data, card, base=None):
    """Merge a (possibly partial) `data` onto the stored data of a section and check every value by kind.

    Returns the full data dict. Raises rest_framework ValidationError({key: [messages]}) on any problem."""
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise ValidationError({"data": ["Must be an object."]})
    defaults = default_data(kind)
    merged = dict(defaults)
    if isinstance(base, dict):
        merged.update({k: v for k, v in base.items() if k in defaults})
    errors = {}
    for key in data:
        if key not in defaults:
            errors[key] = ["This section setting does not exist."]
    _text(errors, merged, data, "title", MAX_TITLE)
    if kind == "products":
        _choice(errors, merged, data, "layout", PRODUCT_LAYOUTS)
    elif kind == "hours":
        if "timezone" in data:
            if isinstance(data["timezone"], str) and data["timezone"] in _zones():
                merged["timezone"] = data["timezone"]
            else:
                errors["timezone"] = ["Choose a time zone from the IANA list, such as Asia/Qatar."]
        _days(errors, merged, data)
        _text(errors, merged, data, "note", 120)
    elif kind == "team":
        _team_cards(errors, merged, data, card)
    elif kind == "event":
        _text(errors, merged, data, "event_name", 120)
        _datetime(errors, merged, data, "starts_at", required=True)
        _datetime(errors, merged, data, "ends_at", required=False)
        if "ends_at" not in errors and "starts_at" not in errors and merged.get("ends_at") and merged.get("starts_at"):
            if merged["ends_at"] <= merged["starts_at"]:
                errors["ends_at"] = ["The end must be after the start."]
        _text(errors, merged, data, "venue", 120)
        _text(errors, merged, data, "hall", 60)
        _text(errors, merged, data, "stand", 40)
        _text(errors, merged, data, "talk_title", 120)
        _text(errors, merged, data, "talk_time", 40)
        _https(errors, merged, data, "slides_url")
    elif kind == "map":
        _text(errors, merged, data, "address", 300, multiline=True)
        _https(errors, merged, data, "maps_url")
        _text(errors, merged, data, "directions_note", MAX_TITLE)
    if errors:
        raise ValidationError(errors)
    return {key: merged[key] for key in defaults}


def check_kind(kind):
    if kind not in KINDS:
        raise validation_error({"kind": ["Choose a section kind from the list."]})


def check_can_add(card, kind):
    """A card holds up to eight sections, one of each kind, except up to three products sections."""
    existing = list(card.sections.values_list("kind", flat=True))
    if len(existing) >= MAX_SECTIONS:
        raise validation_error({"kind": [f"A card can have up to {MAX_SECTIONS} sections."]})
    if kind == "products":
        if existing.count("products") >= MAX_PRODUCT_SECTIONS:
            raise validation_error({"kind": [f"A card can have up to {MAX_PRODUCT_SECTIONS} products sections."]})
    elif kind in existing:
        raise validation_error({"kind": ["This card already has a section of this kind. Change that one instead."]})


def stored_data(section):
    """The section's data with every key of its kind present (never raises: the public page must always render)."""
    defaults = default_data(section.kind)
    data = dict(defaults)
    if isinstance(section.data, dict):
        data.update({k: v for k, v in section.data.items() if k in defaults})
    return data


def section_json(section):
    return {
        "id": str(section.id), "kind": section.kind, "order": section.order, "on": section.on,
        "data": stored_data(section), "created_at": iso(section.created_at), "updated_at": iso(section.updated_at),
    }


def gallery_image_json(image, request):
    return {"id": str(image.id), "url": file_url(request, image.image), "caption": image.caption, "order": image.order}


# ---------------------------------------------------------------- the public page
def _team_members(card, codes, request):
    from .services import public_url

    rows = {c.public_code: c for c in team_card_pool(card.workspace).filter(public_code__in=codes).select_related("workspace")}
    out = []
    for code in codes:
        member = rows.get(code)
        if member is None:
            continue
        out.append({
            "code": member.public_code, "name": member.name, "title": member.title,
            "photo_url": file_url(request, member.photo), "url": public_url(member),
        })
    return out


def _products(section, request):
    """The switched-on products of a products section (those tied to it, plus those tied to no section). The Product
    model is part of the selling features and may be absent while they are not installed: the section is then empty."""
    try:
        from .models import Product  # noqa: F401 - re-exported from the commerce models when they are installed
    except ImportError:
        return []
    try:
        rows = Product.objects.filter(card_id=section.card_id, on=True).filter(
            Q(section_id=section.id) | Q(section_id__isnull=True)
        ).order_by("order")
        return [
            {
                "id": str(p.id), "title": p.title, "description": p.description, "price": str(p.price),
                "currency": p.currency, "image_url": file_url(request, p.image), "badge": p.badge,
                "meta": p.meta, "stock": p.stock,
            }
            for p in rows
        ]
    except (FieldError, AttributeError):
        return []


def public_sections(card, request, gallery=None):
    """The switched-on sections in order, with team cards and gallery pictures expanded for the page.
    Extras the company does not allow on this card are kept in the data but not shown."""
    from . import extras

    allowed = extras.allowed_kinds(card)
    out = []
    for section in card.sections.all():
        if not section.on or section.kind not in allowed:
            continue
        data = stored_data(section)
        if section.kind == "team":
            data["members"] = _team_members(card, data["cards"], request)
        elif section.kind == "gallery":
            images = card.gallery_images.all() if gallery is None else gallery
            data["images"] = [gallery_image_json(i, request) for i in images]
        elif section.kind == "products":
            data["items"] = _products(section, request)
        out.append({"id": str(section.id), "kind": section.kind, "order": section.order, "data": data})
    return out
