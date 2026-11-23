"""Languages of the product and a small dictionary-based translator for e-mails and API messages.

English is the source language: every translatable text is written in English at the place it is used and
looked up here by its exact English wording. A language without an entry for a text falls back to the English
wording, so a missing translation never breaks an e-mail or an API answer.

To add a language: add its code to `SUPPORTED_LANGUAGES`, add it to `RTL_LANGUAGES` when it is written right to
left, add a catalogue module next to `locale_ar.py` and register it in `CATALOGUES`.
"""
import re
from datetime import date, datetime

SUPPORTED_LANGUAGES = ("en", "ar")
DEFAULT_LANGUAGE = "en"
RTL_LANGUAGES = frozenset({"ar"})
# What a card can ask for: a fixed language, or "auto" (the visitor's language).
CARD_LANGUAGES = SUPPORTED_LANGUAGES + ("auto",)

# Unicode isolates keep a Latin name or number from reordering the Arabic sentence around it.
FSI, PDI = "⁨", "⁩"


def normalise_language(value):
    """The supported code for a value such as "ar", "AR" or "ar-QA", or None when it is not supported."""
    if not isinstance(value, str):
        return None
    code = value.strip().lower().replace("_", "-").split("-")[0]
    return code if code in SUPPORTED_LANGUAGES else None


def language_or_default(value):
    return normalise_language(value) or DEFAULT_LANGUAGE


def is_rtl(lang):
    return normalise_language(lang) in RTL_LANGUAGES


def direction(lang):
    return "rtl" if is_rtl(lang) else "ltr"


def from_accept_language(header):
    """The best supported language of an Accept-Language header, or None."""
    if not header:
        return None
    ranked = []
    for index, part in enumerate(str(header).split(",")):
        bits = part.strip().split(";")
        code = normalise_language(bits[0])
        if not code:
            continue
        quality = 1.0
        for extra in bits[1:]:
            extra = extra.strip()
            if extra.startswith("q="):
                try:
                    quality = float(extra[2:])
                except ValueError:
                    quality = 0.0
        if quality > 0:
            ranked.append((-quality, index, code))
    return min(ranked)[2] if ranked else None


def request_language(request):
    """The language of an API request: the X-Language header, then the signed-in user's saved language,
    then Accept-Language, then English."""
    if request is None:
        return DEFAULT_LANGUAGE
    meta = getattr(request, "META", {}) or {}
    explicit = normalise_language(meta.get("HTTP_X_LANGUAGE"))
    if explicit:
        return explicit
    user = getattr(request, "user", None)
    saved = normalise_language(getattr(user, "language", "")) if user is not None and getattr(user, "is_authenticated", False) else None
    return saved or from_accept_language(meta.get("HTTP_ACCEPT_LANGUAGE")) or DEFAULT_LANGUAGE


def user_language(user):
    """The saved language of an account (English when none is saved or there is no account)."""
    return language_or_default(getattr(user, "language", "") if user is not None else "")


def language_for_email(address, fallback=DEFAULT_LANGUAGE):
    """The saved language of the account that uses this address, else `fallback`."""
    if not address:
        return fallback
    from accounts.models import User

    row = User.objects.filter(email__iexact=address).values_list("language", flat=True).first()
    return normalise_language(row) or fallback


def member_language(member):
    """The language for an e-mail to a team member: their account's, else the invite's, else English."""
    if member is None:
        return DEFAULT_LANGUAGE
    user = getattr(member, "user", None)
    return normalise_language(getattr(user, "language", "")) or normalise_language(getattr(member, "language", "")) or DEFAULT_LANGUAGE


# ---------------------------------------------------------------- plural rules
def plural_category(lang, n):
    """CLDR plural category of a whole number: English has one/other, Arabic has zero/one/two/few/many/other."""
    n = abs(int(n))
    if normalise_language(lang) == "ar":
        if n == 0:
            return "zero"
        if n == 1:
            return "one"
        if n == 2:
            return "two"
        if 3 <= n % 100 <= 10:
            return "few"
        if 11 <= n % 100 <= 99:
            return "many"
        return "other"
    return "one" if n == 1 else "other"


# ---------------------------------------------------------------- catalogues
def _catalogues():
    from . import locale_ar

    return {"ar": (locale_ar.TEXTS, locale_ar.PLURALS, locale_ar.MONTHS)}


_CACHE = {}


def _catalogue(lang):
    if not _CACHE:
        _CACHE.update(_catalogues())
    return _CACHE.get(normalise_language(lang))


def _fill(template, lang, params):
    if not params:
        return template
    safe = {}
    for key, value in params.items():
        text = str(value)
        # Isolate only words and mixed text: plain numbers need no protection.
        safe[key] = f"{FSI}{text}{PDI}" if is_rtl(lang) and not re.fullmatch(r"[\d.,:\s%-]*", text) else text
    return template.format(**safe)


def tr(lang, text, **params):
    """`text` (English, with {placeholders}) in `lang`; English when there is no translation."""
    cat = _catalogue(lang)
    template = cat[0].get(text, text) if cat else text
    return _fill(template, lang, params)


def trn(lang, n, one, other, **params):
    """A phrase that depends on a count. `one` and `other` are the English singular and plural wording (both
    may use {n}); the catalogue holds the Arabic forms under the singular wording."""
    cat = _catalogue(lang)
    params = {"n": n, **params}
    if cat and one in cat[1]:
        forms = cat[1][one]
        template = forms.get(plural_category(lang, n)) or forms["other"]
        return _fill(template, lang, params)
    return _fill(one if int(n) == 1 else other, lang, params)


def month_name(lang, month, short=False):
    cat = _catalogue(lang)
    if cat:
        return cat[2][month - 1]
    return date(2000, month, 1).strftime("%b" if short else "%B")


def format_date(lang, value):
    """A date as "22 November 2026" (or the Arabic month name)."""
    if isinstance(value, datetime):
        value = value.date()
    return f"{value.day} {month_name(lang, value.month)} {value.year}"


def localise_message(request, message):
    """An English message in the language of the request (for texts that travel inside a successful answer)."""
    return translate_message(request_language(request), message)


def translate_message(lang, message):
    """Translate an API error message by its exact English wording; unknown messages stay English."""
    cat = _catalogue(lang)
    if not cat or not isinstance(message, str):
        return message
    if message in cat[0]:
        return cat[0][message]
    from . import locale_ar

    for pattern, template in locale_ar.PATTERNS:
        match = pattern.fullmatch(message)
        if match:
            groups = match.groupdict()
            return template(groups) if callable(template) else template.format(**groups)
    return message
