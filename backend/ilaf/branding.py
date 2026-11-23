"""Company branding: the colour palette, logo display options and card artwork stored in Workspace.brand.

The web app computes the palette from the two brand colours and sends both. The server only checks
that every colour is valid and that the text pairs stay readable (WCAG contrast).
"""
import copy
import re

from .errors import validation_error

HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

# Sample pictures the web app draws itself. The server only stores which one was picked.
BACKGROUND_SAMPLES = ("geo", "mesh", "photo", "stripes", "dots", "topo")
TEMPLATE_SAMPLES = ("harbor", "terra", "night")

COLOUR_MODES = ("brand", "light", "dark")
LOGO_DISPLAYS = ("auto", "symbol", "symbol_name", "full")
LOGO_PLACEMENTS = ("card", "above", "both")
LOGO_CORNERS = ("auto", "tl", "tr", "bl", "br")
LOGO_CHIPS = ("auto", "always", "never", "white", "black")
ARTWORK_MODES = ("none", "background", "pattern", "template")
PICTURE_KINDS = ("sample", "upload", "none")
PATTERN_SIZES = ("s", "m", "l")
PATTERN_SPACINGS = ("tight", "normal", "wide")
PATTERN_ANGLES = (0, -15, -30)
TEMPLATE_ZONES = ("A", "B", "C", "D")
TEXT_SIZES = ("s", "m", "l")

# Contrast rules for the palette: text on both backgrounds, and the text on accent buttons.
PALETTE_KEYS = ("bg", "bg2", "fg", "acc", "on")
PALETTE_CHECKS = (
    ("fg", "bg", 4.5, "The text colour is hard to read on the main background"),
    ("fg", "bg2", 4.5, "The text colour is hard to read on the second background"),
    ("on", "acc", 3.0, "The text on accent buttons is hard to read on the accent colour"),
)

# Every key of the new branding set that a company can write.
BRANDING_KEYS = (
    "colours", "palette", "logo_display", "logo_placement", "logo_corner", "logo_chip",
    "show_company_name", "artwork",
)


def default_artwork():
    return {
        "mode": "none",
        "background": {"kind": "none", "sample": None, "strength": 60},
        "pattern": {
            "enabled": False, "size": "m", "spacing": "normal", "angle": 0, "opacity": 18,
            "combine_with_background": False,
        },
        "template": {"kind": "none", "sample": None, "zone": "A", "text_colour": "auto", "text_size": "m"},
    }


def default_branding():
    return {
        "colours": None,
        "palette": None,
        "logo_display": "auto",
        "logo_placement": "both",
        "logo_corner": "auto",
        "logo_chip": "auto",
        "show_company_name": True,
        "artwork": default_artwork(),
    }


def normalize_branding(brand):
    """The branding keys of a stored brand with defaults filled in for anything missing (old rows)."""
    brand = brand or {}
    out = default_branding()
    for key in out:
        if key == "artwork":
            stored = brand.get("artwork")
            if isinstance(stored, dict):
                if stored.get("mode") in ARTWORK_MODES:
                    out["artwork"]["mode"] = stored["mode"]
                for part in ("background", "pattern", "template"):
                    if isinstance(stored.get(part), dict):
                        out["artwork"][part].update(
                            {k: v for k, v in stored[part].items() if k in out["artwork"][part]}
                        )
        elif key in brand:
            out[key] = copy.deepcopy(brand[key])
    return out


def has_palette(workspace):
    return workspace.kind == "company" and bool((workspace.brand or {}).get("palette"))


# ---------------------------------------------------------------- colour maths
def _channel(value):
    value = value / 255
    return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4


def luminance(hex_colour):
    r, g, b = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def contrast_ratio(first, second):
    a, b = luminance(first), luminance(second)
    if a < b:
        a, b = b, a
    return (a + 0.05) / (b + 0.05)


def _is_hex(value):
    return isinstance(value, str) and bool(HEX_RE.match(value))


# ---------------------------------------------------------------- validators
# Each one returns the cleaned value or appends messages to errors[key] and returns None.
def _fail(errors, key, message):
    errors.setdefault(key, []).append(message)


def _choice(errors, key, value, allowed):
    if value in allowed and not isinstance(value, bool):
        return value
    _fail(errors, key, "Choose one of: " + ", ".join(str(a) for a in allowed) + ".")
    return None


def _check_colours(value, errors):
    if value is None:
        return None
    if not isinstance(value, dict):
        _fail(errors, "colours", "Colours must be an object or null.")
        return None
    unknown = set(value) - {"primary", "accent", "mode"}
    if unknown:
        _fail(errors, "colours", "Unknown setting: " + ", ".join(sorted(unknown)) + ".")
    out = {}
    for key in ("primary", "accent"):
        if _is_hex(value.get(key)):
            out[key] = value[key].lower()
        else:
            _fail(errors, f"colours.{key}", "Use a colour like #1a2b3c.")
    out["mode"] = _choice(errors, "colours.mode", value.get("mode", "brand"), COLOUR_MODES)
    return out


def _check_palette(value, errors):
    if value is None:
        return None
    if not isinstance(value, dict):
        _fail(errors, "palette", "Palette must be an object or null.")
        return None
    unknown = set(value) - set(PALETTE_KEYS)
    if unknown:
        _fail(errors, "palette", "Unknown colour: " + ", ".join(sorted(unknown)) + ".")
    out = {}
    for key in PALETTE_KEYS:
        if _is_hex(value.get(key)):
            out[key] = value[key].lower()
        else:
            _fail(errors, f"palette.{key}", "Use a colour like #1a2b3c.")
    if len(out) == len(PALETTE_KEYS):
        for text, ground, needed, message in PALETTE_CHECKS:
            ratio = contrast_ratio(out[text], out[ground])
            if ratio < needed:
                _fail(errors, "palette", f"{message} (contrast {ratio:.1f} to 1, needs {needed:g} to 1).")
    return out


def _merge_part(errors, prefix, current, incoming, checks):
    """Merge a partial dict onto the current one, running a check per key."""
    if incoming is None:
        return current
    if not isinstance(incoming, dict):
        _fail(errors, prefix, "Must be an object.")
        return current
    merged = dict(current)
    for key in incoming:
        if key not in current:
            _fail(errors, f"{prefix}.{key}", "This setting does not exist.")
    for key, check in checks.items():
        if key in incoming:
            value = check(errors, f"{prefix}.{key}", incoming[key])
            if f"{prefix}.{key}" not in errors:
                merged[key] = value
    return merged


def _bool(errors, key, value):
    if isinstance(value, bool):
        return value
    _fail(errors, key, "Must be true or false.")
    return None


def _int_range(low, high):
    def check(errors, key, value):
        if isinstance(value, int) and not isinstance(value, bool) and low <= value <= high:
            return value
        _fail(errors, key, f"Choose a whole number from {low} to {high}.")
        return None
    return check


def _one_of(allowed):
    return lambda errors, key, value: _choice(errors, key, value, allowed)


def _sample(allowed):
    def check(errors, key, value):
        if value is None:
            return None
        return _choice(errors, key, value, allowed)
    return check


def _text_colour(errors, key, value):
    if value == "auto":
        return "auto"
    if _is_hex(value):
        return value.lower()
    _fail(errors, key, "Use auto or a colour like #1a2b3c.")
    return None


def _check_artwork(value, current, errors, has_background_file, has_template_file):
    if not isinstance(value, dict):
        _fail(errors, "artwork", "Artwork must be an object.")
        return current
    art = copy.deepcopy(current)
    for key in value:
        if key not in ("mode", "background", "pattern", "template"):
            _fail(errors, f"artwork.{key}", "This setting does not exist.")
    if "mode" in value:
        mode = _choice(errors, "artwork.mode", value["mode"], ARTWORK_MODES)
        if mode is not None:
            art["mode"] = mode
    art["background"] = _merge_part(errors, "artwork.background", art["background"], value.get("background"), {
        "kind": _one_of(PICTURE_KINDS), "sample": _sample(BACKGROUND_SAMPLES), "strength": _int_range(0, 100),
    })
    art["pattern"] = _merge_part(errors, "artwork.pattern", art["pattern"], value.get("pattern"), {
        "enabled": _bool, "size": _one_of(PATTERN_SIZES), "spacing": _one_of(PATTERN_SPACINGS),
        "angle": _one_of(PATTERN_ANGLES), "opacity": _int_range(5, 60), "combine_with_background": _bool,
    })
    art["template"] = _merge_part(errors, "artwork.template", art["template"], value.get("template"), {
        "kind": _one_of(PICTURE_KINDS), "sample": _sample(TEMPLATE_SAMPLES), "zone": _one_of(TEMPLATE_ZONES),
        "text_colour": _text_colour, "text_size": _one_of(TEXT_SIZES),
    })
    for part, has_file, noun in (("background", has_background_file, "background picture"),
                                 ("template", has_template_file, "front picture")):
        piece = art[part]
        if f"artwork.{part}" in errors or any(k.startswith(f"artwork.{part}.") for k in errors):
            continue
        if piece["kind"] == "sample" and piece["sample"] is None:
            _fail(errors, f"artwork.{part}.sample", "Choose one of the sample pictures.")
        if piece["kind"] != "sample":
            piece["sample"] = None
        if piece["kind"] == "upload" and not has_file:
            _fail(errors, f"artwork.{part}.kind", f"Upload your {noun} first.")
    return art


def merge_branding(workspace, brand, incoming, files):
    """Apply the branding keys of a brand PATCH to the stored brand and return the new brand dict.

    brand is the stored brand dict (already holding any plain-key changes); incoming is the raw brand
    object from the request (only the branding keys are read here).
    files is {"background": bool, "template_front": bool}: which uploaded pictures exist.
    Personal workspaces refuse explicit writes (400). Errors use the keys brand.palette, brand.artwork.x ...
    """
    given = [key for key in BRANDING_KEYS if key in incoming]
    brand = dict(brand)
    if not given:
        return brand
    if workspace.kind != "company":
        raise validation_error({
            f"brand.{key}": ["Company branding is only available on company workspaces."] for key in given
        })
    current = normalize_branding(brand)
    errors = {}
    out = {}
    if "colours" in incoming:
        out["colours"] = _check_colours(incoming["colours"], errors)
    if "palette" in incoming:
        out["palette"] = _check_palette(incoming["palette"], errors)
    for key, allowed in (("logo_display", LOGO_DISPLAYS), ("logo_placement", LOGO_PLACEMENTS),
                         ("logo_corner", LOGO_CORNERS), ("logo_chip", LOGO_CHIPS)):
        if key in incoming:
            out[key] = _choice(errors, key, incoming[key], allowed)
    if "show_company_name" in incoming:
        out["show_company_name"] = _bool(errors, "show_company_name", incoming["show_company_name"])
    if "artwork" in incoming:
        out["artwork"] = _check_artwork(
            incoming["artwork"], current["artwork"], errors, files.get("background"), files.get("template_front"),
        )
    if errors:
        raise validation_error({f"brand.{key}": messages for key, messages in errors.items()})
    brand.update(out)
    # Removing the palette also drops company colours from the company design itself.
    if "palette" in out and out["palette"] is None:
        design = brand.get("design")
        if isinstance(design, dict) and design.get("colour") == 4:
            brand["design"] = {**design, "colour": 0}
    return brand
