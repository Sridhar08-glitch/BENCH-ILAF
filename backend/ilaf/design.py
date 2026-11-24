"""Card design and vCard option validation, shared by cards and company brand settings."""
from django.conf import settings
from rest_framework.exceptions import ValidationError

from .utils import clean_multiline

# Designs are numbers from the design library: a face, a below-the-card layout and an opening animation.
# A face has exactly four colourways of its own, so the card, its icons and the area below always match.
# Faces 401 to 500 are Design Pack 2, behind the "pack2_faces" feature switch (see require_pack2_face).
FACE_COUNT = 500
PACK1_FACE_COUNT = 400
BELOW_COUNT = 400
INTRO_COUNT = 400  # 0 means no opening animation
COLOURWAYS = 4
# Colour 4 means "company colours": the palette of the card's company workspace. It is only accepted when
# that workspace has a palette, and a card that has it falls back to colourway 0 when the palette is removed.
COMPANY_COLOUR = 4
NUMBER_KEYS = {
    "face": (1, FACE_COUNT),
    "colour": (0, COMPANY_COLOUR),
    "below": (1, BELOW_COUNT),
    "intro": (0, INTRO_COUNT),
}
BOOL_KEYS = ("photo", "brand_colors", "foot")
# The typeface of the name, title and contact lines. "face" keeps the fonts each face was drawn with; the other keys are
# the curated list the web app shows in its font picker (the last three are the Arabic choices). The list lives in the
# web app's design library (src/lib/library/text.ts); keep the two in step.
FONT_FACE = "face"
FONT_KEYS = (
    FONT_FACE,
    "poppins", "outfit", "manrope", "space-grotesk", "playfair", "cormorant", "lora",
    "oswald", "bebas", "jetbrains", "caveat", "dancing",
    "plex-arabic", "cairo", "tajawal",
)
# The size of the name, title and contact lines together, in percent of what the face draws.
SIZE_MIN = 60
SIZE_MAX = 150
SIZE_DEFAULT = 100
# What a company design lock controls. The card's own photo switch stays free.
LOCKED_KEYS = ("face", "custom_face", "colour", "below", "intro", "font", "size")

DEFAULT_DESIGN = {
    "face": 1,
    # null, or the id of a custom face made for the card's company (see the designs app). It overrides "face".
    "custom_face": None,
    "colour": 0,
    "below": 1,
    "intro": 1,
    "font": FONT_FACE,
    "size": SIZE_DEFAULT,
    "photo": True,
    "brand_colors": False,
    "foot": True,
}

VC_BOOL_KEYS = ("company", "photo", "phones", "emails", "urls", "social", "addr")


def default_design():
    return dict(DEFAULT_DESIGN)


def default_vc():
    data = {key: True for key in VC_BOOL_KEYS}
    data["note"] = settings.DEFAULT_VCARD_NOTE
    return data


def is_current(design):
    return isinstance(design, dict) and all(isinstance(design.get(k), int) and not isinstance(design.get(k), bool) for k in NUMBER_KEYS)


def _whole(value):
    return isinstance(value, int) and not isinstance(value, bool)


def is_pack2_face(face):
    return _whole(face) and PACK1_FACE_COUNT < face <= FACE_COUNT


def require_pack2_face(data, workspace):
    """A design write that picks a Pack 2 face needs the switch on for this company (403 feature_unavailable otherwise)."""
    if isinstance(data, dict) and is_pack2_face(data.get("face")):
        from staff.flags import require_flag

        require_flag("pack2_faces", workspace)


def validate_design(data, base=None, company_colour_ok=None, custom_face_ok=None):
    """Merge a (possibly partial) design onto a base design and check every value.

    company_colour_ok: None checks the number range only (0 to 4); False also refuses an incoming
    colour 4 (the workspace has no company palette); True allows it. Stored base values are never re-checked.

    custom_face_ok: None checks only that custom_face is null or a positive whole number; False refuses any
    custom face (a personal workspace); a function takes a face id and says whether this workspace may use it.

    Unknown keys (including the old name and colour based keys) are rejected. A stored base from an
    older design format is converted first. Returns the full design dict.
    """
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise ValidationError("Design must be an object.")
    merged = dict(DEFAULT_DESIGN)
    if base:
        if not is_current(base):
            from .legacy import convert_v2_design

            base = convert_v2_design(base)
        merged.update({k: v for k, v in base.items() if k in DEFAULT_DESIGN})
        if merged["font"] not in FONT_KEYS:
            merged["font"] = FONT_FACE
        if not (isinstance(merged["size"], int) and not isinstance(merged["size"], bool) and SIZE_MIN <= merged["size"] <= SIZE_MAX):
            merged["size"] = SIZE_DEFAULT
        if not (_whole(merged["custom_face"]) and merged["custom_face"] > 0):
            merged["custom_face"] = None
    errors = {}
    for key in data:
        if key not in DEFAULT_DESIGN:
            errors[key] = ["This design setting does not exist."]
    for key, (low, high) in NUMBER_KEYS.items():
        if key in data:
            value = data[key]
            if isinstance(value, int) and not isinstance(value, bool) and low <= value <= high:
                merged[key] = value
            else:
                errors[key] = [f"Choose a whole number from {low} to {high}."]
    if company_colour_ok is False and "colour" not in errors and data.get("colour") == COMPANY_COLOUR:
        errors["colour"] = ["Company colours are only available when your company has set its brand colours."]
    if "custom_face" in data:
        value = data["custom_face"]
        if value is None:
            merged["custom_face"] = None
        elif not (_whole(value) and value > 0):
            errors["custom_face"] = ["Choose one of your company's own designs, or leave it empty."]
        elif custom_face_ok is False or (callable(custom_face_ok) and not custom_face_ok(value)):
            errors["custom_face"] = ["This design is not available to your company."]
        else:
            merged["custom_face"] = value
    if "font" in data:
        if isinstance(data["font"], str) and data["font"] in FONT_KEYS:
            merged["font"] = data["font"]
        else:
            errors["font"] = ["Choose one of the available fonts, or \"face\" to keep the design's own fonts."]
    if "size" in data:
        value = data["size"]
        if isinstance(value, int) and not isinstance(value, bool) and SIZE_MIN <= value <= SIZE_MAX:
            merged["size"] = value
        else:
            errors["size"] = [f"Choose a whole number from {SIZE_MIN} to {SIZE_MAX}."]
    for key in BOOL_KEYS:
        if key in data:
            if isinstance(data[key], bool):
                merged[key] = data[key]
            else:
                errors[key] = ["Must be true or false."]
    if errors:
        raise ValidationError(errors)
    return {key: merged[key] for key in DEFAULT_DESIGN}


def validate_vc(data, base=None):
    """Merge and check the vCard options. Unknown keys are ignored."""
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise ValidationError("vCard options must be an object.")
    merged = dict(base) if base else default_vc()
    errors = {}
    for key in VC_BOOL_KEYS:
        if key in data:
            if isinstance(data[key], bool):
                merged[key] = data[key]
            else:
                errors[key] = ["Must be true or false."]
        merged.setdefault(key, True)
    if "note" in data:
        if data["note"] is None:
            merged["note"] = ""
        elif isinstance(data["note"], str):
            try:
                merged["note"] = clean_multiline(data["note"], 300)
            except ValidationError as exc:
                errors["note"] = [str(m) for m in exc.detail]
        else:
            errors["note"] = ["Must be text."]
    merged.setdefault("note", "")
    if errors:
        raise ValidationError(errors)
    return {**{key: merged[key] for key in VC_BOOL_KEYS}, "note": merged["note"]}
