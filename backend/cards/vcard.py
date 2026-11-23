"""Build a vCard 3.0 file for a card, honouring the card's vCard options."""
import base64
import io
import re

from django.conf import settings
from PIL import Image

from ilaf.design import validate_vc
from ilaf.items import PHONE_KINDS, SOCIAL_KINDS, item_href

URL_KINDS = ("Calendly", "Meeting", "AppStore", "GooglePlay", "PayPal", "Custom")


def escape_text(value):
    """Escape a vCard TEXT value: backslash first, then commas, semicolons and line breaks."""
    value = (value or "").replace("\\", "\\\\")
    value = value.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n")
    return value.replace(";", "\\;").replace(",", "\\,")


def fold(line):
    """Fold a line to at most 75 octets per physical line (RFC 2425), never splitting a UTF-8 character."""
    out, current, size, limit = [], [], 0, 75
    for char in line:
        width = len(char.encode("utf-8"))
        if size + width > limit:
            out.append("".join(current))
            current, size, limit = [], 1, 75  # continuation lines start with one space
        current.append(char)
        size += width
    out.append("".join(current))
    return "\r\n ".join(out)


def _digits(value):
    return re.sub(r"\D", "", value or "")


def _number(value):
    """A phone number as text for the TEL line (prefixes removed, formatting kept)."""
    return re.sub(r"^(?:tel|sms):", "", (value or "").strip(), flags=re.I)


# Words that belong to the family name that follows them ("Al Thani", "آل ثاني"), never to the given names.
FAMILY_PREFIXES = {"al", "el", "آل", "ال"}


def _split_name(full_name):
    """(family, given). The last word is the family name, together with a prefix such as "Al" or "آل" before it
    when someone's given name stays in front. Names are never transliterated or reordered: a single word is
    kept whole as the given name."""
    parts = (full_name or "").split()
    if len(parts) <= 1:
        return "", full_name or ""
    family_len = 2 if len(parts) >= 3 and parts[-2].lower() in FAMILY_PREFIXES else 1
    return " ".join(parts[-family_len:]), " ".join(parts[:-family_len])


def _is_latin(value):
    # Latin letters with accents, general punctuation and currency signs need no hint; other scripts (Arabic, ...) do.
    return all(ord(char) < 0x250 or 0x2000 <= ord(char) <= 0x20CF for char in value or "")


def prop(name, value):
    """A text line `NAME:value`. Text that is not plain ASCII (Arabic names, for example) carries `CHARSET=UTF-8`
    so older contact apps that assume a legacy code page still read it right; the file itself is always UTF-8."""
    if _is_latin(value):
        return f"{name}:{value}"
    head, _, params = name.partition(";")
    return f"{head};CHARSET=UTF-8{';' + params if params else ''}:{value}"


def _photo_b64(card):
    try:
        card.photo.open("rb")
        try:
            img = Image.open(card.photo).convert("RGB")
        finally:
            card.photo.close()
        img.thumbnail((256, 256), Image.LANCZOS)
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=82)
        return base64.b64encode(buffer.getvalue()).decode("ascii")
    except Exception:
        return None


def build_vcard(card):
    vc = validate_vc(card.vc)
    items = [i for i in card.items.all() if i.on and (i.value or "").strip()]
    lines = ["BEGIN:VCARD", "VERSION:3.0", f"PRODID:-//{settings.COMPANY_NAME}//{settings.PRODUCT_NAME}//EN"]

    family, given = _split_name(card.name)
    lines.append(prop("N", f"{escape_text(family)};{escape_text(given)};;;"))
    lines.append(prop("FN", escape_text(card.name)))
    if vc["company"] and card.company:
        lines.append(prop("ORG", escape_text(card.company)))
    if card.title:
        lines.append(prop("TITLE", escape_text(card.title)))

    if vc["photo"] and card.photo:
        encoded = _photo_b64(card)
        if encoded:
            lines.append(f"PHOTO;ENCODING=b;TYPE=JPEG:{encoded}")

    if vc["phones"]:
        seen = set()
        for item in items:
            if item.kind not in PHONE_KINDS:
                continue
            digits = _digits(item.value)
            if not digits or digits in seen:
                continue  # a WhatsApp or SMS number that repeats a phone number is written once
            seen.add(digits)
            if item.kind == "WhatsApp" and item.value.lower().startswith("http"):
                continue  # a bare chat link carries no number to save
            kind_type = "WORK,VOICE" if item.kind == "Landline" else "CELL"
            lines.append(f"TEL;TYPE={kind_type}:{escape_text(_number(item.value))}")

    if vc["emails"]:
        for item in items:
            if item.kind == "Email":
                address = re.sub(r"^mailto:", "", item.value, flags=re.I)
                lines.append(f"EMAIL;TYPE=INTERNET:{escape_text(address)}")

    group = 0

    def labelled_url(url, label):
        nonlocal group
        group += 1
        lines.append(f"item{group}.URL:{url}")
        lines.append(prop(f"item{group}.X-ABLabel", escape_text(label)))

    if vc["urls"]:
        for item in items:
            href = item_href(item.kind, item.value)
            if not href.lower().startswith(("http://", "https://")):
                continue
            if item.kind == "Website":
                lines.append(f"URL:{href}")
            elif item.kind in URL_KINDS:
                labelled_url(href, item.label or item.kind)

    # A Custom item holding an email or phone number is saved as that, not as a web link.
    for item in items:
        if item.kind == "Custom":
            href = item_href(item.kind, item.value)
            if href.lower().startswith("mailto:") and vc["emails"]:
                lines.append(f"EMAIL;TYPE=INTERNET:{escape_text(href[7:])}")
            elif href.lower().startswith("tel:") and vc["phones"]:
                lines.append(f"TEL;TYPE=CELL:{escape_text(href[4:])}")

    if vc["social"]:
        for item in items:
            if item.kind in SOCIAL_KINDS:
                href = item_href(item.kind, item.value)
                if href.lower().startswith(("http://", "https://")):
                    labelled_url(href, item.kind)

    if vc["addr"]:
        if card.address:
            lines.append(prop("ADR;TYPE=WORK", f";;{escape_text(card.address)};;;;"))
        for item in items:
            if item.kind == "Location":
                href = item_href(item.kind, item.value)
                if item.value.lower().startswith(("http://", "https://")):
                    labelled_url(href, "Location")
                else:
                    lines.append(prop("ADR;TYPE=WORK", f";;{escape_text(item.value)};;;;"))

    if vc["note"]:
        lines.append(prop("NOTE", escape_text(vc["note"])))

    lines.append("END:VCARD")
    return "\r\n".join(fold(line) for line in lines) + "\r\n"
