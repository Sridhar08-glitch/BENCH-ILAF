"""Per-card feature settings (the exchange-contact form), company lead settings, and the plan rule for rich pages.

Card.features holds `exchange`: whether visitors may share their details, which fields the form asks
for, and an optional custom consent sentence. Workspace.lead_settings holds the company privacy link
and whether company admins are e-mailed about every lead.
"""
from urllib.parse import urlsplit

from rest_framework.exceptions import ValidationError

from ilaf.errors import ApiError
from ilaf.utils import ANY_CONTROL_RE, clean_line

FIELD_MODES = ("off", "optional", "required")
EXCHANGE_FIELDS = ("email", "phone", "company", "note")
MAX_CONSENT = 300


def rich_pages_allowed(workspace):
    """Page styles and rich content (photo headers, page button sets, sections, products, booking, video, gallery)
    belong to the paid plans: true when the workspace holds a subscription to a plan with a price, false on a free
    plan or without a subscription. Only writes ask; a card that already holds a rich setting keeps rendering it."""
    from billing.services import get_subscription, plan_is_paid

    sub = get_subscription(workspace)
    return sub is not None and plan_is_paid(sub.plan)


def require_rich_pages(workspace):
    if not rich_pages_allowed(workspace):
        raise ApiError("plan_limit", "Page styles and rich content are part of the paid plans. Upgrade to use them.", 403)


def default_features():
    return {
        "exchange": {
            "enabled": True,
            "fields": {"email": "optional", "phone": "optional", "company": "optional", "note": "optional"},
            "consent_text": "",
        },
    }


def validate_features(data, base=None):
    """Merge a partial features object onto the stored one and check it. Unknown keys are ignored."""
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise ValidationError("Features must be an object.")
    merged = default_features()
    old = (base or {}).get("exchange") if isinstance(base, dict) else None
    if isinstance(old, dict):
        merged["exchange"]["enabled"] = bool(old.get("enabled", True))
        merged["exchange"]["consent_text"] = str(old.get("consent_text") or "")
        for key in EXCHANGE_FIELDS:
            if (old.get("fields") or {}).get(key) in FIELD_MODES:
                merged["exchange"]["fields"][key] = old["fields"][key]
    errors = {}
    incoming = data.get("exchange")
    if incoming is not None:
        if not isinstance(incoming, dict):
            raise ValidationError({"exchange": ["Must be an object."]})
        ex = merged["exchange"]
        if "enabled" in incoming:
            if isinstance(incoming["enabled"], bool):
                ex["enabled"] = incoming["enabled"]
            else:
                errors["exchange.enabled"] = ["Must be true or false."]
        if "consent_text" in incoming:
            raw = incoming["consent_text"]
            if raw is None:
                ex["consent_text"] = ""
            elif isinstance(raw, str):
                try:
                    ex["consent_text"] = clean_line(raw, MAX_CONSENT)
                except ValidationError as exc:
                    errors["exchange.consent_text"] = [str(m) for m in exc.detail]
            else:
                errors["exchange.consent_text"] = ["Must be text."]
        fields = incoming.get("fields")
        if fields is not None:
            if not isinstance(fields, dict):
                errors["exchange.fields"] = ["Must be an object."]
            else:
                for key, mode in fields.items():
                    if key not in EXCHANGE_FIELDS:
                        continue
                    if mode in FIELD_MODES:
                        ex["fields"][key] = mode
                    else:
                        errors[f"exchange.fields.{key}"] = ["Choose off, optional or required."]
        f = ex["fields"]
        if f["email"] == "off" and f["phone"] == "off":
            errors["exchange.fields"] = ["Ask for an email address or a phone number, so you can reach the visitor."]
    if errors:
        raise ValidationError(errors)
    return merged


def exchange_settings(card):
    """The card's exchange settings with defaults filled in."""
    return validate_features(None, base=card.features)["exchange"]


def default_lead_settings():
    return {"privacy_url": "", "notify_admins": False}


def validate_lead_settings(data, base=None):
    merged = {**default_lead_settings(), **{k: v for k, v in (base or {}).items() if k in default_lead_settings()}}
    if not isinstance(data, dict):
        raise ValidationError("Settings must be an object.")
    errors = {}
    if "privacy_url" in data:
        raw = data["privacy_url"]
        if raw is None or raw == "":
            merged["privacy_url"] = ""
        elif not isinstance(raw, str):
            errors["privacy_url"] = ["Must be text."]
        else:
            value = raw.strip()
            try:
                parts = urlsplit(value if "://" in value else "https://" + value)
            except ValueError:
                parts = None
            if (
                ANY_CONTROL_RE.search(value) or len(value) > 300 or parts is None
                or parts.scheme not in ("http", "https") or "." not in (parts.hostname or "")
                or parts.username or parts.password or " " in value
            ):
                errors["privacy_url"] = ["Enter the web address of your privacy page, such as https://example.com/privacy."]
            else:
                merged["privacy_url"] = value if "://" in value else "https://" + value
    if "notify_admins" in data:
        if isinstance(data["notify_admins"], bool):
            merged["notify_admins"] = data["notify_admins"]
        else:
            errors["notify_admins"] = ["Must be true or false."]
    if errors:
        raise ValidationError(errors)
    return merged


def public_features(card):
    """What the public page needs to draw the exchange form (never the owner's e-mail address)."""
    from django.conf import settings as dj_settings

    ex = exchange_settings(card)
    privacy = ((card.workspace.lead_settings or {}).get("privacy_url") or "")
    has_form = any(
        i.kind == "Meeting" and i.on and (i.value or "").strip().lower() == "form" for i in card.items.all()
    )
    return {
        "exchange": {
            "enabled": ex["enabled"],
            "fields": ex["fields"],
            "consent_text": ex["consent_text"] or f"I agree that {card.name or 'the card owner'} may store my details and contact me.",
            "privacy_url": privacy or None,
        },
        "meeting_form": has_form,
    }
