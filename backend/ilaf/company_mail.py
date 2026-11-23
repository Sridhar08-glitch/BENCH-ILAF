"""How a company's own e-mails look: its logo on top, its colour on the button, "Northgate via Product" as the sender.

Everything here falls back to the product look when the company has no logo or colour, or when a colour would not be
readable. `company_style` is the one entry point; ilaf.emails.send_brand_email uses it when given a workspace."""
import re
from email.utils import formataddr, parseaddr

from django.conf import settings
from django.core.cache import cache

HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
WHITE = "#FFFFFF"


def _luminance(colour):
    def channel(v):
        v = v / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (int(colour[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast(first, second):
    a, b = _luminance(first), _luminance(second)
    if a < b:
        a, b = b, a
    return (a + 0.05) / (b + 0.05)


def button_colours(workspace):
    """(background, text) for the e-mail button: the company accent with white or ink text, whichever reads better
    (at least 4.5 to 1). A missing or unreadable colour gives the product's orange with ink text."""
    brand = workspace.brand or {}
    palette = brand.get("palette") or {}
    colours = brand.get("colours") or {}
    for candidate in (palette.get("acc"), colours.get("accent"), colours.get("primary")):
        if isinstance(candidate, str) and HEX_RE.match(candidate):
            for text in (WHITE, settings.BRAND_BLACK):
                if contrast(candidate, text) >= 4.5:
                    return candidate.upper(), text
    return settings.BRAND_ORANGE, settings.BRAND_BLACK


def logo_reachable(url):
    """True when a HEAD request for the logo answers 2xx. The answer is remembered for six hours. Switched on with
    EMAIL_LOGO_CHECK (it needs network access from the server)."""
    if not getattr(settings, "EMAIL_LOGO_CHECK", False):
        return True
    key = "mail-logo:" + url
    known = cache.get(key)
    if known is not None:
        return known
    import urllib.request

    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=3) as res:  # the address is the company's own uploaded logo on our storage
            ok = 200 <= res.status < 300
    except Exception:
        ok = False
    cache.set(key, ok, 6 * 3600)
    return ok


def logo_url(workspace):
    from ilaf.utils import file_url

    if not workspace.logo:
        return None
    url = file_url(None, workspace.logo)
    if not url or not url.startswith("https://") or not logo_reachable(url):
        return None
    return url


def sender_name(workspace):
    """"Northgate via Product": no line breaks, quotes or angle brackets, and not longer than 60 characters."""
    name = re.sub(r"[\r\n\"<>]+", " ", workspace.name or "").strip()[:60]
    return f"{name} via {settings.PRODUCT_NAME}" if name else settings.PRODUCT_NAME


def from_address(workspace):
    address = parseaddr(settings.DEFAULT_FROM_EMAIL)[1] or settings.DEFAULT_FROM_EMAIL
    return formataddr((sender_name(workspace), address))


def reply_to_list(workspace):
    try:
        policy = workspace.policy
    except Exception:
        return []
    return [policy.reply_to_email] if policy.reply_to_email else []


def company_style(workspace):
    """The e-mail look of a company workspace, or None for a personal workspace or none at all."""
    if workspace is None or getattr(workspace, "kind", "") != "company":
        return None
    accent, on = button_colours(workspace)
    return {
        "name": workspace.name,
        "logo": logo_url(workspace),
        "accent": accent,
        "on": on,
        "from": from_address(workspace),
        "reply_to": reply_to_list(workspace),
    }
