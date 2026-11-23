"""Card item rules: kinds, safe link schemes, value normalisation and the clickable `href`.

Card buttons open real links on public pages, so a value must never be able to carry a
script. Every value is checked against ALLOWED_SCHEMES (the single list to extend).
"""
import re
from urllib.parse import quote, urlsplit

from rest_framework.exceptions import ValidationError

from .utils import ANY_CONTROL_RE

# The one list of link schemes a card button may use. Add a scheme here to allow it everywhere.
ALLOWED_SCHEMES = (
    "http", "https", "tel", "mailto", "sms", "skype", "tg", "viber", "facetime", "facetime-audio", "geo",
)

KINDS = (
    "Mobile", "Landline", "WhatsApp", "Email", "SMS", "Location", "Website", "Facebook", "Instagram",
    "LinkedIn", "X", "YouTube", "TikTok", "Snapchat", "Telegram", "Pinterest", "Threads", "GitHub",
    "Behance", "Dribbble", "Discord", "Spotify", "SoundCloud", "Twitch", "Reddit", "Medium", "Calendly",
    "AppStore", "GooglePlay", "PayPal", "Meeting", "Custom",
    "Document", "Menu", "Vimeo", "Loom", "GoogleReview", "Trustpilot", "TripAdvisor", "AppleMaps", "WhatsAppChannel",
    "Airbnb", "Etsy", "Shopify", "Amazon", "DownloadFile",
)
PHONE_KINDS = ("Mobile", "Landline", "WhatsApp", "SMS")
# Kinds written to a vCard as labelled social links.
SOCIAL_KINDS = (
    "Facebook", "Instagram", "LinkedIn", "X", "YouTube", "TikTok", "Snapchat", "Telegram", "Pinterest",
    "Threads", "GitHub", "Behance", "Dribbble", "Discord", "Spotify", "SoundCloud", "Twitch", "Reddit",
    "Medium",
)
MAX_ITEMS = 40
MAX_VALUE = 500
MAX_LABEL = 40

# Where a bare handle such as "jane" or "@jane" points to for each platform.
PROFILE_URLS = {
    "Facebook": "https://facebook.com/{h}",
    "Instagram": "https://instagram.com/{h}",
    "LinkedIn": "https://linkedin.com/in/{h}",
    "X": "https://x.com/{h}",
    "YouTube": "https://youtube.com/@{h}",
    "TikTok": "https://tiktok.com/@{h}",
    "Snapchat": "https://snapchat.com/add/{h}",
    "Telegram": "https://t.me/{h}",
    "Pinterest": "https://pinterest.com/{h}",
    "Threads": "https://threads.net/@{h}",
    "GitHub": "https://github.com/{h}",
    "Behance": "https://behance.net/{h}",
    "Dribbble": "https://dribbble.com/{h}",
    "Discord": "https://discord.gg/{h}",
    "Spotify": "https://open.spotify.com/user/{h}",
    "SoundCloud": "https://soundcloud.com/{h}",
    "Twitch": "https://twitch.tv/{h}",
    "Reddit": "https://reddit.com/user/{h}",
    "Medium": "https://medium.com/@{h}",
    "Calendly": "https://calendly.com/{h}",
    "PayPal": "https://paypal.me/{h}",
}

def _tld(name):
    """A pattern for a site that exists under many country endings (amazon.com, amazon.co.uk, amazon.ae)."""
    return re.compile(rf"(^|\.){name}\.(com|[a-z]{{2}}|co\.[a-z]{{2}}|com\.[a-z]{{2}})$")


# Kinds whose value is a web page on a known site: the link must be https and its host must belong to the site.
# None means any https address (a menu or catalogue can sit on the company's own site or a file service).
WEB_KIND_HOSTS = {
    "Document": None,
    "Menu": None,
    "Shopify": None,
    "Vimeo": ("vimeo.com",),
    "Loom": ("loom.com",),
    "GoogleReview": ("g.page", "g.co", "goo.gl", "maps.app.goo.gl", _tld("google")),
    "Trustpilot": ("trustpilot.com",),
    "TripAdvisor": (_tld("tripadvisor"),),
    "AppleMaps": ("maps.apple.com", "maps.apple"),
    "WhatsAppChannel": ("whatsapp.com", "chat.whatsapp.com"),
    "Airbnb": (_tld("airbnb"), "abnb.me"),
    "Etsy": ("etsy.com",),
    "Amazon": (_tld("amazon"), "a.co", "amzn.to", "amzn.eu", "amzn.com"),
}
# The kind whose value is a PDF the person uploaded to us (see cards.views.CardFileView).
DOWNLOAD_KIND = "DownloadFile"
MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024


def _host_matches(host, rules):
    for rule in rules:
        if isinstance(rule, str):
            if host == rule or host.endswith("." + rule):
                return True
        elif rule.search(host):
            return True
    return False


def normalise_web_kind(kind, value):
    """A https link for one of the WEB_KIND_HOSTS kinds. A bare domain gets https://; http and other schemes are refused."""
    scheme = scheme_of(value)
    if scheme is not None and scheme != "https":
        raise ValidationError("Enter a web address that starts with https://.")
    url = value if scheme else "https://" + value.lstrip("/")
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
    except ValueError:
        raise ValidationError("Enter a web address that starts with https://.")
    if re.search(r"\s", url) or "." not in host or parts.username or parts.password:
        raise ValidationError("Enter a web address that starts with https://.")
    rules = WEB_KIND_HOSTS[kind]
    if rules is not None and not _host_matches(host, rules):
        raise ValidationError("This link does not match the type of button you chose.")
    # A channel lives under whatsapp.com/channel/...; a community invite is chat.whatsapp.com/<code>.
    if kind == "WhatsAppChannel" and host != "chat.whatsapp.com" and not parts.path.startswith("/channel/"):
        raise ValidationError("This link does not match the type of button you chose.")
    return url


def normalise_download(value):
    """The address of a PDF we stored (the upload answer). Only the shape is checked here; the card write also checks
    that the file belongs to this card."""
    scheme = scheme_of(value)
    if scheme not in ("http", "https") or re.search(r"\s", value) or not urlsplit(value).path.lower().endswith(".pdf"):
        raise ValidationError("Upload the PDF first and use the address we returned.")
    return value


_SCHEME_RE = re.compile(r"^([A-Za-z][A-Za-z0-9+.\-]*):(.*)$", re.S)
_PHONE_RE = re.compile(r"^\+?[\d\s().\-]{3,32}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_HOST_PORT_RE = re.compile(r"^\d{1,5}(?:[/?#]|$)")


def scheme_of(value):
    """The lowercase scheme of a value, or None. 'example.com:8080' is a host and port, not a scheme."""
    match = _SCHEME_RE.match(value)
    if not match:
        return None
    scheme = match.group(1).lower()
    if ("." in scheme or scheme == "localhost") and _HOST_PORT_RE.match(match.group(2)):
        return None
    return scheme


def has_unsafe_scheme(value):
    scheme = scheme_of((value or "").strip())
    return scheme is not None and scheme not in ALLOWED_SCHEMES


def _digits(value):
    return re.sub(r"\D", "", value)


def _phone_number(value):
    """Digits with a leading + kept (00 counts as +). Local numbers stay without a plus."""
    value = re.sub(r"^(?:tel|sms|viber|facetime(?:-audio)?):", "", value.strip(), flags=re.I).lstrip("/")
    plus = value.startswith("+") or value.startswith("00")
    digits = _digits(value)
    if value.startswith("00"):
        digits = digits[2:]
    return ("+" if plus else "") + digits


def normalise_custom(value):
    """A Custom value may be any link, email or phone number; return the clean link form."""
    scheme = scheme_of(value)
    if scheme in ALLOWED_SCHEMES:
        return value
    if scheme is None:
        if _EMAIL_RE.match(value):
            return "mailto:" + value
        if _PHONE_RE.match(value) and len(_digits(value)) >= 5:
            return "tel:" + _phone_number(value)
        if " " not in value and ("." in value or value.startswith("localhost")):
            return "https://" + value.lstrip("/")
    raise ValidationError("Enter a link, an email address or a phone number.")


# Booking pages that get a branded name. The first matching host suffix wins.
MEETING_PROVIDERS = (
    ("calendly.com", "Calendly"),
    ("calendar.app.google", "Google Calendar"),
    ("calendar.google.com", "Google Calendar"),
    ("cal.com", "Cal.com"),
    ("outlook.office365.com", "Microsoft Bookings"),
    ("outlook.office.com", "Microsoft Bookings"),
    ("bookings.microsoft.com", "Microsoft Bookings"),
    ("book.ms", "Microsoft Bookings"),
    ("tidycal.com", "TidyCal"),
    ("savvycal.com", "SavvyCal"),
    ("meetings.hubspot.com", "HubSpot Meetings"),
    ("zoom.us", "Zoom Scheduler"),
)
# A Meeting button holding this word opens the built-in request form instead of a link.
MEETING_FORM = "form"
MEETING_HREF = "#meeting-request"


def meeting_provider(url):
    """The branded name of a known booking page host, or None."""
    host = (urlsplit(url or "").hostname or "").lower()
    for suffix, name in MEETING_PROVIDERS:
        if host == suffix or host.endswith("." + suffix):
            return name
    return None


def normalise_meeting(value):
    """A booking link must be https. Bare domains get https://; the word `form` selects the built-in form."""
    if value.lower() == MEETING_FORM:
        return MEETING_FORM
    scheme = scheme_of(value)
    if scheme is not None and scheme != "https":
        raise ValidationError("A meeting link must start with https://.")
    url = value if scheme else "https://" + value.lstrip("/")
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
    except ValueError:
        raise ValidationError("Enter the web address of your booking page.")
    if re.search(r"\s", url) or "." not in host or parts.username or parts.password:
        raise ValidationError("Enter the web address of your booking page, such as https://calendly.com/yourname.")
    return url


def validate_value(kind, value):
    """Check and tidy one item value. Raises ValidationError with a plain message."""
    value = (value or "").strip()
    if not value:
        return ""
    if ANY_CONTROL_RE.search(value):
        raise ValidationError("Control characters are not allowed.")
    if len(value) > MAX_VALUE:
        raise ValidationError(f"Keep this under {MAX_VALUE} characters.")
    if has_unsafe_scheme(value):
        raise ValidationError(
            "This kind of link is not allowed. Use http, https, tel, mailto or sms style links."
        )
    if kind == "Custom":
        return normalise_custom(value)
    if kind == "Meeting":
        return normalise_meeting(value)
    if kind in WEB_KIND_HOSTS:
        return normalise_web_kind(kind, value)
    if kind == DOWNLOAD_KIND:
        return normalise_download(value)
    if kind in PHONE_KINDS:
        bare = re.sub(r"^(?:tel|sms):", "", value, flags=re.I)
        is_wa_link = kind == "WhatsApp" and value.lower().startswith(("http://", "https://"))
        if not (_PHONE_RE.match(bare) or is_wa_link):
            raise ValidationError("Enter a phone number such as +974 5555 5555.")
    if kind == "Email":
        bare = re.sub(r"^mailto:", "", value, flags=re.I)
        if not _EMAIL_RE.match(bare):
            raise ValidationError("Enter a valid email address.")
    return value


def _web_href(kind, value):
    scheme = scheme_of(value)
    if scheme in ALLOWED_SCHEMES:
        return value
    if re.search(r"\s", value):
        return ""
    if kind in PROFILE_URLS and "." not in value:
        # A bare handle (or handle/path such as a Calendly event) becomes the platform's profile link.
        return PROFILE_URLS[kind].format(h=quote(value.lstrip("@/"), safe="/"))
    return "https://" + value.lstrip("/")


def item_href(kind, value):
    """The ready-to-open link for an item, or an empty string when none can be made."""
    value = (value or "").strip()
    if not value or has_unsafe_scheme(value):
        return ""
    if kind in ("Mobile", "Landline"):
        return "tel:" + _phone_number(value)
    if kind == "SMS":
        return "sms:" + _phone_number(value)
    if kind == "WhatsApp":
        if value.lower().startswith(("http://", "https://")):
            return value
        return "https://wa.me/" + _digits(value)
    if kind == "Email":
        return "mailto:" + re.sub(r"^mailto:", "", value, flags=re.I)
    if kind == "Meeting":
        return MEETING_HREF if value.lower() == MEETING_FORM else value
    if kind == "Location":
        if scheme_of(value) in ("http", "https", "geo"):
            return value
        return "https://www.google.com/maps/search/?api=1&query=" + quote(value, safe="")
    return _web_href(kind, value)


# ---------------------------------------------------------------- icons
ICON_TYPES = ("auto", "brand", "lucide", "upload")
_ICON_KEY_RE = re.compile(r"^[A-Za-z0-9-]{1,60}$")


def validate_icon(icon, media_prefixes):
    """Check an item's icon override. `media_prefixes` lists the URL prefixes our own uploads live under."""
    if icon is None:
        return None
    if not isinstance(icon, dict):
        raise ValidationError("Icon must be an object or null.")
    icon_type = icon.get("type", "auto")
    if icon_type not in ICON_TYPES:
        raise ValidationError(f"Icon type must be one of: {', '.join(ICON_TYPES)}.")
    key = icon.get("key")
    image_url = icon.get("image_url")
    if icon_type in ("brand", "lucide"):
        if not isinstance(key, str) or not _ICON_KEY_RE.match(key):
            raise ValidationError("Icon key may use letters, digits and dashes only (max 60).")
        return {"type": icon_type, "key": key, "image_url": None}
    if icon_type == "upload":
        if not isinstance(image_url, str) or not any(image_url.startswith(p) for p in media_prefixes):
            raise ValidationError("Upload the icon image first and use the URL we returned.")
        return {"type": "upload", "key": None, "image_url": image_url}
    return {"type": "auto", "key": None, "image_url": None}
