"""A Google Wallet "generic pass" for a published card, and the "Save to Google Wallet" link.

The link carries a signed JWT that contains both the pass class and the pass object, so Google
creates them when the person taps Save and no call to the Wallet REST API is needed. The JWT is
signed (RS256) with the private key of the service account; the issuer id comes from the Google
Pay & Wallet Console.
"""
import hashlib
import json
import time
from pathlib import Path

from django.conf import settings

from cards.services import public_url
from ilaf import rsa
from ilaf.branding import HEX_RE, contrast_ratio
from ilaf.errors import ApiError
from ilaf.items import item_href
from ilaf.utils import file_url

SAVE_URL = "https://pay.google.com/gp/v/save/"
# Longer save links are less reliable in some browsers and mail apps, so a bigger pass drops its optional parts.
MAX_JWT_CHARS = 3000
PHONE_KINDS = ("Mobile", "Landline", "WhatsApp")
MAX_TEXT_MODULES = 6
MAX_LINKS = 6
_key_cache = {}


def not_configured(message="Google Wallet passes are not set up on this server."):
    return ApiError("wallet_not_configured", message, 503)


def _service_account_text():
    inline = settings.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON
    if inline:
        return inline
    path = settings.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE
    if path:
        try:
            return Path(path).read_text(encoding="utf-8")
        except OSError:
            return ""
    return ""


def load_service_account():
    """(client e-mail, private key) of the service account, or a 503 wallet_not_configured error."""
    text = _service_account_text()
    if not settings.GOOGLE_WALLET_ISSUER_ID or not text:
        raise not_configured()
    cache_key = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if cache_key not in _key_cache:
        try:
            info = json.loads(text)
            _key_cache[cache_key] = (str(info["client_email"]), rsa.PrivateKey.from_pem(info["private_key"]))
        except (ValueError, KeyError, TypeError, rsa.RsaError):
            raise not_configured("The Google Wallet service account key on this server is not valid.")
    return _key_cache[cache_key]


def is_configured():
    try:
        load_service_account()
    except ApiError:
        return False
    return True


# ---------------------------------------------------------------- colours

def safe_background(colour, fallback=None):
    """A background colour Google can put text on: a valid #rrggbb that gives white text at least 4.5:1
    or black text at least 7:1. A middle tone that reads badly either way is darkened until it works."""
    fallback = fallback or settings.BRAND_BLACK
    colour = colour.upper() if isinstance(colour, str) and HEX_RE.match(colour) else fallback.upper()
    for _ in range(12):
        if contrast_ratio(colour, "#FFFFFF") >= 4.5 or contrast_ratio(colour, "#000000") >= 7:
            return colour
        channels = [int(colour[i:i + 2], 16) for i in (1, 3, 5)]
        colour = "#" + "".join(f"{int(c * 0.85):02X}" for c in channels)
    return fallback.upper()


def card_background(card):
    workspace = card.workspace
    palette = (workspace.brand or {}).get("palette") if workspace.kind == "company" else None
    if isinstance(palette, dict):
        return safe_background(palette.get("bg"))
    return safe_background(settings.BRAND_BLACK)


# ---------------------------------------------------------------- the pass

def class_id(issuer):
    return f"{issuer}.{settings.GOOGLE_WALLET_CLASS_SUFFIX}"


def object_id(issuer, card):
    return f"{issuer}.{card.public_code}"


def _localized(value):
    return {"defaultValue": {"language": "en-US", "value": str(value)}}


def _https(request, field, warnings, what):
    url = file_url(request, field)
    if not url:
        return None
    if not url.startswith("https://") or "localhost" in url or "127.0.0.1" in url:
        warnings.append(f"The {what} was left out: Google can only load pictures from a public https address.")
        return None
    return url


def build_object(card, request=None, level=0):
    """The pass object. Higher `level` drops optional parts to keep the link short."""
    issuer = settings.GOOGLE_WALLET_ISSUER_ID
    workspace = card.workspace
    warnings = []
    company = card.company or (workspace.brand or {}).get("company_name") or ""
    url = public_url(card)
    obj = {
        "id": object_id(issuer, card),
        "classId": class_id(issuer),
        "state": "ACTIVE",
        "cardTitle": _localized(company or settings.PRODUCT_NAME),
        "header": _localized(card.name or company or settings.PRODUCT_NAME),
        "hexBackgroundColor": card_background(card),
        "barcode": {"type": "QR_CODE", "value": f"{url}?s=qr", "alternateText": card.slug or card.public_code},
    }
    if card.title:
        obj["subheader"] = _localized(card.title)

    logo = _https(request, workspace.logo or workspace.symbol, warnings, "company logo") if workspace.kind == "company" else None
    logo = logo or _https(request, card.photo, warnings, "card photo")
    if logo:
        obj["logo"] = {"sourceUri": {"uri": logo}, "contentDescription": _localized(company or card.name or "Logo")}
    if level < 2:
        hero = _https(request, card.cover or (workspace.background if workspace.kind == "company" else None), warnings, "cover picture")
        if hero:
            obj["heroImage"] = {"sourceUri": {"uri": hero}, "contentDescription": _localized(card.name or "Card")}

    modules, links = [], []
    items = [i for i in card.items.all() if i.on and (i.value or "").strip()]
    phones = [i for i in items if i.kind in PHONE_KINDS]
    emails = [i for i in items if i.kind == "Email"]
    websites = [i for i in items if i.kind == "Website"]
    if phones:
        modules.append({"id": "phone", "header": "Phone", "body": phones[0].value.strip()[:80]})
    if emails:
        modules.append({"id": "email", "header": "Email", "body": emails[0].value.strip()[:80]})
    if websites:
        modules.append({"id": "website", "header": "Website", "body": websites[0].value.strip()[:80]})
    if card.address and level < 3:
        modules.append({"id": "address", "header": "Address", "body": card.address[:120]})
    obj["textModulesData"] = modules[:MAX_TEXT_MODULES]
    if level < 1:
        for item in items:
            href = item_href(item.kind, item.value)
            if href.startswith(("https://", "http://")) and len(links) < MAX_LINKS:
                links.append({"uri": href, "description": (item.label or item.kind)[:40], "id": f"l{len(links) + 1}"})
        links.insert(0, {"uri": url, "description": "Open my card", "id": "card"})
        obj["linksModuleData"] = {"uris": links[:MAX_LINKS]}
    obj["_warnings"] = warnings
    return obj


def sign_save_jwt(obj, issuer_email, key, now=None):
    obj = {k: v for k, v in obj.items() if k != "_warnings"}
    claims = {
        "iss": issuer_email,
        "aud": "google",
        "typ": "savetowallet",
        "iat": int(now if now is not None else time.time()),
        "origins": [settings.WEB_BASE_URL],
        "payload": {
            "genericClasses": [{"id": obj["classId"]}],
            "genericObjects": [obj],
        },
    }
    return rsa.jwt_encode_rs256(claims, key)


def save_link(card, request=None, now=None):
    """(save URL, warnings) for a card. Optional parts are dropped until the link is short enough."""
    email, key = load_service_account()
    token, warnings = "", []
    for level in range(4):
        obj = build_object(card, request, level)
        warnings = obj["_warnings"]
        token = sign_save_jwt(obj, email, key, now)
        if len(token) <= MAX_JWT_CHARS:
            break
    if len(token) > MAX_JWT_CHARS:
        warnings = warnings + ["The pass is large; some phones may not open the save link."]
    return SAVE_URL + token, sorted(set(warnings))

