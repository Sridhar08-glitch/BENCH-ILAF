"""Reading a signed-in device from the request: a short label ("Chrome on Windows"), a masked address and a fingerprint."""
import hashlib
import re

from django.conf import settings

from ilaf.utils import client_country, client_ip, parse_ip

# Order matters: Edge, Opera and Samsung Internet also say "Chrome"; Chrome on iOS says "CriOS".
_BROWSERS = [
    (r"edg(e|a|ios)?/", "Edge"), (r"opr/|opera", "Opera"), (r"samsungbrowser", "Samsung Internet"),
    (r"firefox/|fxios", "Firefox"), (r"crios/|chrome/", "Chrome"), (r"version/.*safari/", "Safari"), (r"safari/", "Safari"),
]
_SYSTEMS = [
    (r"iphone", "iPhone"), (r"ipad", "iPad"), (r"android", "Android"), (r"windows", "Windows"),
    (r"cros", "ChromeOS"), (r"macintosh|mac os", "macOS"), (r"linux|x11", "Linux"),
]


def request_user_agent(request):
    """The browser's User-Agent. The web server forwards it as X-Client-User-Agent (its own User-Agent is the server's)."""
    meta = request.META
    return (meta.get("HTTP_X_CLIENT_USER_AGENT") or meta.get("HTTP_USER_AGENT") or "")[:400]


def parse_user_agent(user_agent):
    """(browser, system, kind) with kind one of "phone", "tablet", "desktop", "other". Unknown parts are empty strings."""
    ua = (user_agent or "").lower()
    browser = next((name for pattern, name in _BROWSERS if re.search(pattern, ua)), "")
    system = next((name for pattern, name in _SYSTEMS if re.search(pattern, ua)), "")
    if system in ("iPhone",) or (system == "Android" and "mobile" in ua):
        kind = "phone"
    elif system in ("iPad",) or system == "Android":
        kind = "tablet"
    elif system:
        kind = "desktop"
    else:
        kind = "other"
    return browser, system, kind


def device_label(user_agent):
    """A readable name that never shows the raw header. Empty when nothing is known (the page then shows a generic name)."""
    browser, system, _kind = parse_user_agent(user_agent)
    if browser and system:
        return f"{browser} on {system}"
    return browser or system or ""


def mask_ip(address):
    """The address with its last part hidden: 203.0.113.x, or the first three groups of an IPv6 address."""
    ip = parse_ip(address)
    if ip is None:
        return ""
    if ip.version == 4:
        return ".".join(str(ip).split(".")[:3]) + ".x"
    groups = ip.exploded.split(":")
    return ":".join(groups[:3]) + ":x"


def fingerprint(user, user_agent):
    """One value per person and kind of browser/system, so a new device can be recognised without keeping the raw header."""
    browser, system, kind = parse_user_agent(user_agent)
    raw = f"{user.pk}|{browser}|{system}|{kind}|{settings.SECRET_KEY}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def describe(request):
    """Everything recorded about the device of one request."""
    ua = request_user_agent(request)
    country = client_country(request)
    return {
        "label": device_label(ua),
        "kind": parse_user_agent(ua)[2],
        "ip_masked": mask_ip(client_ip(request)),
        "country": "" if country == "unknown" else country,
    }
