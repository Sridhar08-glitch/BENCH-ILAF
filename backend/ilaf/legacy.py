"""Frozen conversion of the old layout-based design to the current one (used by data migrations).

Kept separate and dependency-free so a migration keeps working when the live design rules change.
"""
LAYOUT_TO_FACE = {
    "classic": "classic", "left": "edge", "banner": "bands", "minimal": "swiss", "grid": "split",
    "icons": "orbit", "floating": "frame", "poster": "magazine", "duo": "stack", "linkbio": "portrait",
}
OLD_KEYS = ("layout", "bgm", "font", "btn", "shape", "cover", "addr", "acts")


def _hex_to_rgb(value, fallback):
    value = value if isinstance(value, str) and value.startswith("#") else fallback
    value = value[1:]
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    try:
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return _hex_to_rgb(fallback, fallback)


def _to_hex(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(c))) for c in rgb)


def _luminance(rgb):
    def channel(c):
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_on(rgb):
    """Black or white, whichever reads better on the colour."""
    lum = _luminance(rgb)
    black_ratio = (lum + 0.05) / 0.05
    white_ratio = 1.05 / (lum + 0.05)
    return "#000000" if black_ratio >= white_ratio else "#ffffff"


def is_legacy(design):
    return isinstance(design, dict) and (any(k in design for k in OLD_KEYS) or "face" not in design)


def convert_legacy_design(old):
    old = old if isinstance(old, dict) else {}
    bg = _hex_to_rgb(old.get("bg"), "#ffffff")
    fg = _hex_to_rgb(old.get("fg"), "#111111")
    acc = _hex_to_rgb(old.get("acc"), "#ff5a1f")
    bg2 = tuple(b + (f - b) * 0.10 for b, f in zip(bg, fg))
    return {
        "face": LAYOUT_TO_FACE.get(old.get("layout"), "classic"),
        "bg": _to_hex(bg),
        "bg2": _to_hex(bg2),
        "fg": _to_hex(fg),
        "acc": _to_hex(acc),
        "on": contrast_on(acc),
        "details": "list",
        "intro": "fade-up",
        "photo": True,
        "brand_colors": bool(old.get("brand_colors", False)),
        "foot": bool(old.get("foot", True)),
    }


# The second design format (named faces, free colours) to the numbered library. The first 25 faces, the
# first 12 below-the-card layouts and the first 22 openings keep their order in the library, so a name
# maps to its position. Free colours become the face's first colourway.
V2_FACES = (
    "classic", "split", "monogram", "edge", "portrait", "frame", "swiss", "bubble", "bands", "glass", "neon",
    "terminal", "ticket", "magazine", "arch", "wave", "corner", "stack", "blueprint", "pills", "orbit",
    "letterpress", "aurora", "dotmatrix", "ribbon",
)
V2_DETAILS = (
    "list", "grid", "spec", "chips", "brand", "contacts", "timeline", "bento", "dock", "editorial", "tabs",
    "accordion",
)
V2_INTROS = (
    "fade-up", "fade-in", "zoom", "elastic", "drop", "blur", "slide-left", "slide-right", "flip", "cube",
    "unfold", "book", "spin", "deal", "envelope", "curtain", "door", "shutter", "spotlight", "wipe",
    "typewriter", "ripple",
)


def convert_v2_design(old):
    """Turn a named-face design (or an even older layout design) into a numbered one."""
    old = old if isinstance(old, dict) else {}
    if any(k in old for k in OLD_KEYS):
        old = convert_legacy_design(old)
    face = V2_FACES.index(old["face"]) + 1 if old.get("face") in V2_FACES else 1
    below = V2_DETAILS.index(old["details"]) + 1 if old.get("details") in V2_DETAILS else 1
    intro = V2_INTROS.index(old["intro"]) + 1 if old.get("intro") in V2_INTROS else (0 if old.get("intro") == "none" else 1)
    return {
        "face": face,
        "colour": 0,
        "below": below,
        "intro": intro,
        "photo": bool(old.get("photo", True)),
        "brand_colors": bool(old.get("brand_colors", False)),
        "foot": bool(old.get("foot", True)),
    }
