"""Slugs (friendly addresses) and public codes (permanent random addresses)."""
import re
import secrets

from .models import Card, SlugHistory

CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
CODE_LENGTH = 10
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$")
# Words that would clash with web app routes.
RESERVED = {
    "app", "api", "admin", "c", "join", "login", "logout", "register", "signup", "pricing", "about",
    "help", "support", "terms", "privacy", "static", "media", "public", "www", "brand", "assets",
    "settings", "billing", "cards", "team", "leads", "analytics", "new", "ilaf", "ilafone", "bench",
}


def _address_in_use(value, ignore_card=None):
    """True when the value is already a code, a slug or an old slug of another card."""
    cards = Card.objects.filter(public_code=value) | Card.objects.filter(slug=value)
    if ignore_card is not None:
        cards = cards.exclude(pk=ignore_card.pk)
    if cards.exists():
        return True
    history = SlugHistory.objects.filter(slug=value)
    if ignore_card is not None:
        history = history.exclude(card=ignore_card)
    return history.exists()


def generate_public_code():
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if not _address_in_use(code):
            return code


def normalise_slug(raw):
    return (raw or "").strip().lower()


def slug_problem(slug, card=None):
    """None when the slug can be used, else ('invalid'|'taken', message)."""
    if not SLUG_RE.match(slug):
        return "invalid", "Use 3 to 40 letters, numbers or dashes, starting and ending with a letter or number."
    if slug in RESERVED:
        return "taken", "This address is reserved."
    if _address_in_use(slug, ignore_card=card):
        return "taken", "This address is already taken."
    return None


def suggest_slug(slug):
    base = re.sub(r"[^a-z0-9-]+", "-", slug.lower()).strip("-")[:34] or "card"
    if len(base) < 3:
        base = base + "-card"
    for n in range(2, 100):
        candidate = f"{base}-{n}"
        if slug_problem(candidate) is None:
            return candidate
    return f"{base}-{secrets.token_hex(2)}"


def resolve_card(key):
    """Find a card by public code, slug or old slug. Returns the Card or None."""
    key = (key or "").strip().lower()
    if not key:
        return None
    card = Card.objects.select_related("workspace", "owner", "member__department").filter(public_code=key).first()
    if card is None:
        card = Card.objects.select_related("workspace", "owner", "member__department").filter(slug=key).first()
    if card is None:
        old = SlugHistory.objects.select_related("card__workspace", "card__owner", "card__member__department").filter(slug=key).first()
        card = old.card if old else None
    return card
