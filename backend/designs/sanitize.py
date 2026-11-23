"""The safe template language of a custom card face: an allowlist sanitiser for the HTML subset and the CSS subset.

This module is authoritative: a face is saved only in the form returned here. The web app (src/lib/library/custom/
sanitize.ts) holds a line-for-line port that re-checks the stored text before drawing it. Keep the two in step; the
shared corpus in tests/sanitize_corpus.json is read by both test suites.

Nothing here executes or evaluates anything. The input is cut into tokens, each token is checked against a short list of
what is allowed, and the output is written again from the checked pieces (never copied), so an odd input can only get
shorter, never stranger. Whatever is removed is reported as a warning.

TEMPLATE (HTML subset)
  tags        div span p i b small br img and an SVG subset (svg g defs path rect circle ellipse line polyline polygon
              linearGradient radialGradient stop clipPath mask)
  attributes  class (everywhere), src alt width height (img), SVG drawing attributes (see SVG_ATTRS)
  no style attributes, no event attributes, no links, no ids except on SVG gradients, clips and masks
  text        {{name}} style placeholders, {{#if x}} ... {{else}} ... {{/if}}, other text with only safe entities
CSS (subset)
  rules       selectors of classes, allowed tags, a few pseudo-classes and ::before/::after, every one prefixed with the
              face's own scope; @keyframes whose name starts with the face id
  values      lengths in cqw, % and em only, colours, gradients, a short function list, data:image and own media urls
"""
import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

MAX_TEMPLATE_BYTES = 60 * 1024
MAX_CSS_BYTES = 120 * 1024
MAX_DATA_BYTES = 200 * 1024
MAX_DEPTH = 20
MAX_ELEMENTS = 500
MAX_RULES = 400
MAX_ANIMATION_SECONDS = 5.0

# ---------------------------------------------------------------- placeholders
TEXT_PLACEHOLDERS = (
    "name", "first", "last", "title", "company", "address", "phone", "email", "web", "initials",
)
BLOCK_PLACEHOLDERS = (
    "photo", "qr", "logo", "symbol", "phone_line", "email_line", "web_line", "address_line", "lines",
)
PLACEHOLDERS = TEXT_PLACEHOLDERS + BLOCK_PLACEHOLDERS
# A condition may name any placeholder: it is true when that value exists for the person (a photo that is switched on
# and uploaded, a phone number, a company logo, ...).
CONDITIONS = PLACEHOLDERS

# ---------------------------------------------------------------- HTML tables
HTML_TAGS = {"div", "span", "p", "i", "b", "small", "br", "img"}
SVG_TAGS = {
    "svg": "svg", "g": "g", "defs": "defs", "path": "path", "rect": "rect", "circle": "circle", "ellipse": "ellipse",
    "line": "line", "polyline": "polyline", "polygon": "polygon", "lineargradient": "linearGradient",
    "radialgradient": "radialGradient", "stop": "stop", "clippath": "clipPath", "mask": "mask",
}
SVG_LEAVES = {"path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "stop"}
VOID = {"br", "img"}
# Dropped together with everything inside them.
DROP_CONTENT = {
    "script", "style", "iframe", "object", "embed", "template", "noscript", "textarea", "title", "head", "xmp",
    "plaintext", "noembed", "noframes", "frameset", "applet", "math", "foreignobject", "use", "image", "animate",
    "animatetransform", "animatemotion", "set", "audio", "video", "canvas", "select", "option", "svg:script",
    "link", "meta", "base", "form", "input", "button", "iframe", "frame", "marquee", "bgsound", "dialog",
}
# These classes belong to the card engine and its company logic; a face may not use them as its own.
RESERVED_CLASSES = {
    "card", "inner", "face", "back", "flipped", "stg", "pg", "cfl", "tpf", "tpb", "colg", "copatw", "coband", "cobg",
    "cobandf", "cohead", "dv", "tabs3", "foot", "cotpl", "cobgp", "copg", "mea", "hasfont",
    # names the dashboard's own stylesheet uses; they would leak its styling into the face
    "app", "av", "bar", "bars", "btn", "byline", "cam", "chip", "chipb", "chips", "clrs", "copybox", "cp", "cr", "d", "detg", "device", "dg", "dg2", "dgv", "dlg", "dn", "dsz", "edit", "empty", "err", "eyebrow", "faceg", "fg", "g2", "g3", "gal", "grow", "grp", "head", "hint", "iconsgrid", "ini", "ipick", "irow", "kpi", "kpis", "langpick", "legend", "li", "linkbtn", "list", "logo", "ltr", "main", "mono", "morepanel", "mq", "nav", "nfc", "notice", "only-sm", "opt", "optrow", "pane", "panel", "photo", "pick", "pill", "plan", "plans", "plat", "plats", "pr", "presets", "prow", "qrbig", "qrcard", "qrx", "row", "saved", "scanwrap", "scr", "search", "sechead", "seg", "sh", "sheet", "side", "skeleton", "split", "stage", "strip", "sub", "sw", "swatches", "switch", "tab", "tabs", "th", "themes", "tile", "toast", "toggle", "top", "topbar", "trow", "two", "up", "upsell", "usage", "vcf", "via", "view", "who", "who2", "x",
}
CLASS_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,40}\Z", re.ASCII)
ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,30}\Z", re.ASCII)
NUMBER = r"-?(?:\d+\.?\d*|\.\d+)"
LENGTH_RE = re.compile(rf"^{NUMBER}(?:%|em|cqw)?\Z", re.ASCII)
PLAIN_NUMBER_RE = re.compile(rf"^{NUMBER}\Z", re.ASCII)
UNIT_INTERVAL_RE = re.compile(r"^(?:0?\.\d+|0|1|1\.0+|0\.0+)\Z", re.ASCII)
PATH_RE = re.compile(r"^[MmLlHhVvCcSsQqTtAaZz0-9 \t\n\r\f,.+\-eE]{0,24000}\Z", re.ASCII)
POINTS_RE = re.compile(r"^[0-9 \t\n\r\f,.+\-eE]{0,8000}\Z", re.ASCII)
TRANSFORM_RE = re.compile(
    rf"^(?:\s*(?:translate|rotate|scale|skewX|skewY|matrix)\s*\(\s*{NUMBER}(?:\s*[ ,]\s*{NUMBER}){{0,5}}\s*\)\s*)+\Z", re.ASCII
)
VIEWBOX_RE = re.compile(rf"^\s*{NUMBER}(?:[\s,]+{NUMBER}){{3}}\s*\Z", re.ASCII)
DASH_RE = re.compile(rf"^{NUMBER}(?:[\s,]+{NUMBER}){{0,7}}\Z", re.ASCII)
ASPECT_RE = re.compile(r"^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(?:meet|slice))?\Z", re.ASCII)
HEX_COLOUR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\Z", re.ASCII)
FUNC_COLOUR_RE = re.compile(
    rf"^(?:rgba?|hsla?)\(\s*{NUMBER}%?(?:\s*[ ,]\s*{NUMBER}%?){{2}}(?:\s*[,/]\s*{NUMBER}%?)?\s*\)\Z", re.ASCII
)
VAR_RE = re.compile(r"^var\(--(?:cbg|cbg2|cfg|cacc|con|pgbg|pgfg|pacc|pon|ffx)\)\Z", re.ASCII)
URL_REF_RE = re.compile(r"^url\(#([A-Za-z][A-Za-z0-9_-]{0,30})\)\Z", re.ASCII)
DATA_IMAGE_RE = re.compile(r"^data:image/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}\Z", re.ASCII)
DATA_SVG_RE = re.compile(r"^data:image/svg\+xml(?:;base64,[A-Za-z0-9+/]+={0,2}|;utf8,[^\x00-\x1f\"'<>\\]*|,[A-Za-z0-9%._~!$&*+,;:@/=?#()\-]*)\Z", re.ASCII)

NAMED_COLOURS = set("""aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray
darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew
hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple
red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray
slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow
yellowgreen transparent currentcolor""".split())

# attribute -> kind. Kinds are checked in _svg_attr.
SVG_ATTRS = {
    "d": "path", "points": "points", "transform": "transform", "gradienttransform": "transform", "viewbox": "viewbox",
    "preserveaspectratio": "aspect", "stroke-dasharray": "dash",
    "x": "length", "y": "length", "x1": "length", "y1": "length", "x2": "length", "y2": "length", "cx": "length",
    "cy": "length", "r": "length", "rx": "length", "ry": "length", "fx": "length", "fy": "length", "width": "length",
    "height": "length", "stroke-width": "length", "stroke-miterlimit": "number", "offset": "offset",
    "fill": "paint", "stroke": "paint", "stop-color": "paint",
    "opacity": "unit", "fill-opacity": "unit", "stroke-opacity": "unit", "stop-opacity": "unit",
    "clip-path": "ref", "mask": "ref", "id": "id",
    "stroke-linecap": "enum:butt|round|square", "stroke-linejoin": "enum:miter|round|bevel",
    "fill-rule": "enum:nonzero|evenodd", "clip-rule": "enum:nonzero|evenodd",
    "gradientunits": "enum:userSpaceOnUse|objectBoundingBox", "spreadmethod": "enum:pad|reflect|repeat",
    "clippathunits": "enum:userSpaceOnUse|objectBoundingBox", "maskunits": "enum:userSpaceOnUse|objectBoundingBox",
}
ATTR_CASE = {
    "viewbox": "viewBox", "preserveaspectratio": "preserveAspectRatio", "gradienttransform": "gradientTransform",
    "gradientunits": "gradientUnits", "spreadmethod": "spreadMethod", "clippathunits": "clipPathUnits",
    "maskunits": "maskUnits",
}
# which SVG attributes each element may carry (everything else is dropped)
SVG_ELEMENT_ATTRS = {
    "svg": {"viewbox", "preserveaspectratio", "width", "height"},
    "g": {"transform", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity",
          "fill-opacity", "stroke-opacity", "clip-path", "mask", "id", "fill-rule"},
    "defs": set(),
    "path": {"d", "transform", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
             "stroke-miterlimit", "opacity", "fill-opacity", "stroke-opacity", "fill-rule", "clip-rule", "clip-path", "mask"},
    "rect": {"x", "y", "width", "height", "rx", "ry", "transform", "fill", "stroke", "stroke-width", "stroke-linejoin",
             "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "clip-path", "mask"},
    "circle": {"cx", "cy", "r", "transform", "fill", "stroke", "stroke-width", "stroke-dasharray", "opacity",
               "fill-opacity", "stroke-opacity", "clip-path", "mask"},
    "ellipse": {"cx", "cy", "rx", "ry", "transform", "fill", "stroke", "stroke-width", "stroke-dasharray", "opacity",
                "fill-opacity", "stroke-opacity", "clip-path", "mask"},
    "line": {"x1", "y1", "x2", "y2", "transform", "stroke", "stroke-width", "stroke-linecap", "stroke-dasharray",
             "opacity", "stroke-opacity", "clip-path", "mask"},
    "polyline": {"points", "transform", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
                 "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "clip-path", "mask"},
    "polygon": {"points", "transform", "fill", "stroke", "stroke-width", "stroke-linejoin", "stroke-dasharray",
                "opacity", "fill-opacity", "stroke-opacity", "fill-rule", "clip-path", "mask"},
    "lineargradient": {"id", "x1", "y1", "x2", "y2", "gradientunits", "gradienttransform", "spreadmethod"},
    "radialgradient": {"id", "cx", "cy", "r", "fx", "fy", "gradientunits", "gradienttransform", "spreadmethod"},
    "stop": {"offset", "stop-color", "stop-opacity"},
    "clippath": {"id", "clippathunits", "transform"},
    "mask": {"id", "maskunits", "x", "y", "width", "height"},
}


@dataclass
class Result:
    value: str = ""
    warnings: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    data_bytes: int = 0


class _Warn:
    """Collects warnings, one line per kind of problem with a count."""

    def __init__(self, where):
        self.where = where
        self.rows = {}
        self.params = {}

    def add(self, code, message, **params):
        key = (code, message)
        self.rows[key] = self.rows.get(key, 0) + 1
        self.params[key] = params

    def out(self):
        """One entry per kind of problem: where it was found, a short code, an English sentence, how many times and the
        values the sentence mentions (so a page can word it in any language from the code)."""
        return [
            {"where": self.where, "code": code, "message": message, "count": n, "params": self.params[(code, message)]}
            for (code, message), n in self.rows.items()
        ]


DATA_RUN_RE = re.compile(r"data:image/[A-Za-z0-9+;=,/%._~!$&*()#:@-]*")


def _text_bytes(src):
    """The size that counts against the template and CSS limits: embedded pictures have their own 200 KB budget, and the
    whole input may never be more than the two together."""
    total = len(src.encode("utf-8", "ignore"))
    if total > MAX_DATA_BYTES + max(MAX_TEMPLATE_BYTES, MAX_CSS_BYTES):
        return total
    return len(DATA_RUN_RE.sub("", src).encode("utf-8", "ignore"))


_ASCII_UPPER = {c: c + 32 for c in range(65, 91)}


def _lower(text):
    """Lower-case the letters A to Z only, so Python and the web port agree on every input."""
    return text.translate(_ASCII_UPPER)


def _strip(text):
    return text.strip(" \t\n\r\f\v")


def _words(text):
    return [w for w in re.split(r"[ \t\n\r\f\v]+", text) if w]


def _strip_controls(text):
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f  ﻿]", "", text)


# ================================================================ HTML
ENTITY_RE = re.compile(r"&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|amp|lt|gt|quot|apos|nbsp);")
NAMED_DECODE = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'", "nbsp": " ", "colon": ":",
                "tab": "\t", "newline": "\n", "lpar": "(", "rpar": ")", "sol": "/", "bsol": "\\", "semi": ";",
                "comma": ",", "period": ".", "num": "#", "lbrace": "{", "rbrace": "}", "lbrack": "[", "rbrack": "]"}
DECODE_RE = re.compile(r"&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]{2,10}));?")


def decode_entities(value):
    """Decode the character references a browser would decode in an attribute value (numeric ones and a few names)."""

    def one(m):
        if m.group(1) is not None:
            code = int(m.group(1))
        elif m.group(2) is not None:
            code = int(m.group(2), 16)
        else:
            name = _lower(m.group(3))
            return NAMED_DECODE.get(name, m.group(0))
        if code == 0 or code > 0x10FFFF or 0xD800 <= code <= 0xDFFF:
            return "�"
        return chr(code)

    return DECODE_RE.sub(one, value)


def escape_attr(value):
    return value.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&#39;")


def escape_text(text):
    """Text with `<`, `>` and bare `&` made harmless; the few safe character references are kept."""
    out = []
    i = 0
    for m in ENTITY_RE.finditer(text):
        if m.start() > i:
            out.append(_esc_plain(text[i:m.start()]))
        ref = m.group(0)
        if ref[1] == "#":
            number = int(ref[3:-1], 16) if ref[2] in "xX" else int(ref[2:-1])
            if number == 0 or number > 0x10FFFF or 0xD800 <= number <= 0xDFFF or number < 32 and number not in (9, 10, 13):
                out.append(_esc_plain(ref))
            else:
                out.append(ref)
        else:
            out.append(ref)
        i = m.end()
    out.append(_esc_plain(text[i:]))
    return "".join(out)


def _esc_plain(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


PLACEHOLDER_RE = re.compile(r"\{\{([^{}]{0,40})\}\}")


_LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _tokenise_html(src):
    """Yield ("text", s), ("start", name, attrs, self_closing), ("end", name). Comments and the like are dropped."""
    i = 0
    n = len(src)
    while i < n:
        lt = src.find("<", i)
        if lt < 0:
            yield ("text", src[i:])
            return
        if lt > i:
            yield ("text", src[i:lt])
        i = lt
        if src.startswith("<!--", i):
            end = src.find("-->", i + 4)
            yield ("dropped", "comment")
            if end < 0:
                return
            i = end + 3
            continue
        nxt = src[i + 1] if i + 1 < n else ""
        if nxt == "/" and i + 2 < n and src[i + 2] in _LETTERS:
            m = re.compile(r"</([A-Za-z][A-Za-z0-9:_-]*)").match(src, i)
            end = src.find(">", m.end())
            yield ("end", _lower(m.group(1)))
            if end < 0:
                return
            i = end + 1
            continue
        if nxt and nxt in _LETTERS:
            m = re.compile(r"<([A-Za-z][A-Za-z0-9:_-]*)").match(src, i)
            name = _lower(m.group(1))
            j = m.end()
            attrs = []
            self_closing = False
            closed = False
            while j < n:
                while j < n and src[j] in " \t\r\n\f":
                    j += 1
                if j >= n:
                    break
                if src[j] == ">":
                    j += 1
                    closed = True
                    break
                if src.startswith("/>", j):
                    self_closing = True
                    closed = True
                    j += 2
                    break
                if src[j] == "/":
                    j += 1
                    continue
                am = re.compile(r"[^ \t\n\r\f\v\"'<>/=]+").match(src, j)
                if not am:
                    j += 1
                    continue
                aname = _lower(am.group(0))
                j = am.end()
                while j < n and src[j] in " \t\r\n\f":
                    j += 1
                value = ""
                if j < n and src[j] == "=":
                    j += 1
                    while j < n and src[j] in " \t\r\n\f":
                        j += 1
                    if j < n and src[j] in "\"'":
                        q = src[j]
                        end = src.find(q, j + 1)
                        if end < 0:
                            value = src[j + 1:]
                            j = n
                        else:
                            value = src[j + 1:end]
                            j = end + 1
                    else:
                        vm = re.compile(r"[^ \t\n\r\f\v>]*").match(src, j)
                        value = vm.group(0)
                        j = vm.end()
                attrs.append((aname, value))
            if not closed:
                yield ("dropped", "unfinished tag")
                return
            yield ("start", name, attrs, self_closing)
            i = j
            continue
        if nxt in ("!", "?"):
            end = src.find(">", i)
            yield ("dropped", "declaration")
            if end < 0:
                return
            i = end + 1
            continue
        yield ("text", "<")
        i += 1


def _paint_ok(value):
    v = _strip(value)
    if _lower(v) in ("none", "currentcolor"):
        return True
    if HEX_COLOUR_RE.match(v) or FUNC_COLOUR_RE.match(v) or VAR_RE.match(v) or URL_REF_RE.match(v):
        return True
    return _lower(v) in NAMED_COLOURS


def _svg_attr(name, value):
    """The cleaned value of an SVG attribute, or None when it is not allowed."""
    kind = SVG_ATTRS[name]
    v = _strip(value)
    if kind == "path":
        return v if PATH_RE.match(v) else None
    if kind == "points":
        return v if POINTS_RE.match(v) else None
    if kind == "transform":
        return v if TRANSFORM_RE.match(v) else None
    if kind == "viewbox":
        return v if VIEWBOX_RE.match(v) else None
    if kind == "aspect":
        return v if ASPECT_RE.match(v) else None
    if kind == "dash":
        return v if DASH_RE.match(v) else None
    if kind == "length":
        return v if LENGTH_RE.match(v) else None
    if kind == "number":
        return v if PLAIN_NUMBER_RE.match(v) else None
    if kind == "offset":
        return v if re.match(rf"^{NUMBER}%?\Z", v, re.ASCII) else None
    if kind == "paint":
        return v if _paint_ok(v) else None
    if kind == "unit":
        return v if UNIT_INTERVAL_RE.match(v) else None
    if kind == "ref":
        return v if _lower(v) == "none" or URL_REF_RE.match(v) else None
    if kind == "id":
        return v if ID_RE.match(v) else None
    if kind.startswith("enum:"):
        return v if v in kind[5:].split("|") else None
    return None


def _data_or_media(value, allowed_media, counter):
    """An image address that may be drawn: a data:image address, or one of the company's own uploaded files."""
    v = _strip(value)
    if DATA_IMAGE_RE.match(v):
        if counter[0] + len(v) > MAX_DATA_BYTES:
            return None
        counter[0] += len(v)
        return v
    path = urlsplit(v).path if "://" in v or v.startswith("/") else None
    if path and not v.startswith("//") and any(path == urlsplit(a).path for a in allowed_media):
        if re.match(r"^(?:https?://[A-Za-z0-9.:\[\]-]+)?/[A-Za-z0-9_./~%-]{1,300}\Z", v):
            return v
    return None


def sanitize_template(src, allowed_media=(), warn=None):
    """Clean a face template. Returns a Result whose `value` is the safe template."""
    w = warn or _Warn("template")
    res = Result()
    if not isinstance(src, str):
        res.errors.append({"where": "template", "code": "type", "message": "The template must be text."})
        return res
    if _text_bytes(src) > MAX_TEMPLATE_BYTES:
        res.errors.append({
            "where": "template", "code": "too_large",
            "message": f"The template is larger than {MAX_TEMPLATE_BYTES // 1024} KB.",
        })
        return res
    src = _strip_controls(src)
    out = []
    # frames: ("el", lower_tag, close_html) | ("ghost", lower_tag) | ("if", has_else)
    stack = []
    skip = None  # (tag, depth) while inside a dropped element
    elements = 0
    data = [0]
    pending = []  # text waits here until something is written, so text either side of a removed piece joins up

    def flush():
        if pending:
            _emit_text("".join(pending), out, stack, w)
            pending.clear()

    for token in _tokenise_html(src):
        kind = token[0]
        if skip is not None:
            if kind == "start" and token[1] == skip[0] and not token[3]:
                skip = (skip[0], skip[1] + 1)
            elif kind == "end" and token[1] == skip[0]:
                skip = (skip[0], skip[1] - 1) if skip[1] > 1 else None
            continue
        if kind == "dropped":
            code, message = {
                "comment": ("comment", "Removed a comment."), "unfinished tag": ("unfinished_tag", "Removed an unfinished tag."),
                "declaration": ("declaration", "Removed a declaration or processing instruction."),
            }[token[1]]
            w.add(code, message)
            continue
        if kind == "text":
            pending.append(token[1])
            continue
        if kind == "end":
            name = token[1]
            idx = next((k for k in range(len(stack) - 1, -1, -1) if stack[k][0] in ("el", "ghost") and stack[k][1] == name), None)
            if idx is None:
                continue
            if any(f[0] != "ghost" for f in stack[idx:]):
                flush()
            while len(stack) - 1 > idx:
                frame = stack.pop()
                if frame[0] == "if":
                    out.append("{{/if}}")
                    w.add("if_closed", "Closed an if block that was still open.")
                elif frame[0] == "el":
                    out.append(frame[2])
            frame = stack.pop()
            if frame[0] == "el":
                out.append(frame[2])
            continue
        # start tag
        _, name, attrs, self_closing = token
        if name in DROP_CONTENT:
            w.add("dropped_element", f"Removed the <{name}> element: it is not allowed.", tag=name)
            if not self_closing and name not in ("link", "meta", "base", "input", "frame"):
                skip = (name, 1)
            continue
        is_svg = name in SVG_TAGS
        if name not in HTML_TAGS and not is_svg:
            w.add("unwrapped", f"Removed the <{name}> tag but kept its text: only simple boxes and text are allowed.", tag=name)
            if not self_closing and name not in VOID:
                stack.append(("ghost", name))
            continue
        elements += 1
        if elements > MAX_ELEMENTS:
            res.errors.append({"where": "template", "code": "too_many", "message": f"More than {MAX_ELEMENTS} elements."})
            return res
        if sum(1 for f in stack if f[0] == "el") >= MAX_DEPTH:
            w.add("too_deep", f"Removed a box nested more than {MAX_DEPTH} levels deep.", max=MAX_DEPTH)
            if not self_closing and name not in VOID:
                stack.append(("ghost", name))
            continue
        canon = SVG_TAGS[name] if is_svg else name
        allowed = SVG_ELEMENT_ATTRS[name] if is_svg else None
        built = []
        seen = set()
        for aname, avalue in attrs:
            value = decode_entities(avalue)
            value = _strip_controls(value)
            if aname in seen:
                continue
            seen.add(aname)
            if aname == "class":
                names = []
                for c in _words(value):
                    if not CLASS_RE.match(c):
                        w.add("class", "Removed a class name with odd characters.")
                    elif _lower(c) in RESERVED_CLASSES:
                        w.add("reserved_class", f"Removed the class \"{c}\": the card engine uses it.", name=c)
                    else:
                        names.append(c)
                if names:
                    built.append(f' class="{escape_attr(" ".join(names))}"')
                continue
            if aname.startswith("on"):
                w.add("event_attr", f"Removed the {aname} attribute: scripts are not allowed.", name=aname)
                continue
            if aname == "style":
                w.add("style_attr", "Removed a style attribute: use classes and the CSS box instead.")
                continue
            if name == "img":
                if aname == "src":
                    cleaned = _data_or_media(value, allowed_media, data)
                    if cleaned is None:
                        w.add("img_src", "Removed an image address: only pictures embedded as data:image or your own uploaded files are allowed.")
                    else:
                        built.append(f' src="{escape_attr(cleaned)}"')
                    continue
                if aname == "alt":
                    built.append(f' alt="{escape_attr(value[:120])}"')
                    continue
                if aname in ("width", "height") and LENGTH_RE.match(_strip(value)):
                    built.append(f' {aname}="{escape_attr(_strip(value))}"')
                    continue
            if is_svg and aname in allowed:
                cleaned = _svg_attr(aname, value)
                if cleaned is None:
                    w.add("svg_attr", f"Removed the {aname} value on <{canon}>: it is not an allowed value.", name=aname, tag=canon)
                else:
                    built.append(f' {ATTR_CASE.get(aname, aname)}="{escape_attr(cleaned)}"')
                continue
            w.add("attr", f"Removed the {aname} attribute on <{canon}>.", name=aname, tag=canon)
        if name == "img" and " src=" not in "".join(built):
            w.add("img_no_src", "Removed an image without a usable address.")
            continue
        flush()
        open_html = f"<{canon}{''.join(built)}"
        if name in VOID:
            out.append(open_html + ">")
        elif name in SVG_LEAVES:
            out.append(open_html + "/>")
        else:
            out.append(open_html + ">")
            stack.append(("el", name, f"</{canon}>"))
    flush()
    while stack:
        frame = stack.pop()
        if frame[0] == "if":
            out.append("{{/if}}")
            w.add("if_closed", "Closed an if block that was still open.")
        elif frame[0] == "el":
            out.append(frame[2])
    res.value = "".join(out)
    res.warnings = w.out()
    res.data_bytes = data[0]
    return res


def _emit_text(text, out, stack, w):
    pos = 0
    for m in PLACEHOLDER_RE.finditer(text):
        if m.start() > pos:
            out.append(escape_text(text[pos:m.start()]))
        pos = m.end()
        inner = " ".join(_words(m.group(1)))
        if inner in PLACEHOLDERS:
            out.append("{{" + inner + "}}")
        elif inner.startswith("#if "):
            cond = _strip(inner[4:])
            if cond in CONDITIONS:
                stack.append(("if", False))
                out.append("{{#if " + cond + "}}")
            else:
                w.add("if_unknown", f"Removed the placeholder \"{inner}\": no such value to test.", text=inner)
        elif inner == "else":
            if stack and stack[-1][0] == "if" and not stack[-1][1]:
                stack[-1] = ("if", True)
                out.append("{{else}}")
            else:
                w.add("else_stray", "Removed an else that has no if block directly around it.")
        elif inner == "/if":
            if stack and stack[-1][0] == "if":
                stack.pop()
                out.append("{{/if}}")
            else:
                w.add("endif_stray", "Removed an end-if that has no if block in the same box.")
        else:
            w.add("placeholder", f"Removed the placeholder \"{inner}\": it is not one of the values a face can show.", text=inner)
    out.append(escape_text(text[pos:]))


# ================================================================ CSS
@dataclass
class Tok:
    t: str       # ws ident func atkw hash string num dim perc url delim { } ( ) [ ] ; : , bad
    v: str = ""
    n: float = 0.0
    u: str = ""


_HEX = "0123456789abcdefABCDEF"


def _is_ident_start(c):
    return c.isalpha() and c.isascii() or c == "_" or ord(c) > 127


def _is_ident_char(c):
    return _is_ident_start(c) or c.isdigit() and c.isascii() or c == "-"


def _read_escape(s, i):
    """After a backslash at s[i-1]: returns (char, next index)."""
    if i >= len(s):
        return "�", i
    c = s[i]
    if c in _HEX:
        j = i
        while j < len(s) and j - i < 6 and s[j] in _HEX:
            j += 1
        code = int(s[i:j], 16)
        if j < len(s) and s[j] in " \t\n\r\f":
            j += 1
        if code == 0 or code > 0x10FFFF or 0xD800 <= code <= 0xDFFF:
            code = 0xFFFD
        return chr(code), j
    return c, i + 1


def _read_name(s, i):
    out = []
    n = len(s)
    while i < n:
        c = s[i]
        if _is_ident_char(c):
            out.append(c)
            i += 1
        elif c == "\\" and i + 1 < n and s[i + 1] != "\n":
            ch, i = _read_escape(s, i + 1)
            out.append(ch)
        else:
            break
    return "".join(out), i


def _starts_ident(s, i):
    n = len(s)
    if i >= n:
        return False
    c = s[i]
    if c == "-":
        if i + 1 < n and (_is_ident_start(s[i + 1]) or s[i + 1] == "-" or (s[i + 1] == "\\" and i + 2 < n and s[i + 2] != "\n")):
            return True
        return False
    if _is_ident_start(c):
        return True
    return c == "\\" and i + 1 < n and s[i + 1] != "\n"


NUM_RE = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", re.ASCII)


def _tokenise_css(s):
    toks = []
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c in " \t\r\n\f":
            while i < n and s[i] in " \t\r\n\f":
                i += 1
            toks.append(Tok("ws"))
            continue
        if c == "/" and s.startswith("/*", i):
            end = s.find("*/", i + 2)
            if end < 0:
                break
            i = end + 2
            continue
        if c in "\"'":
            q = c
            i += 1
            buf = []
            bad = False
            while i < n:
                d = s[i]
                if d == q:
                    i += 1
                    break
                if d == "\n":
                    bad = True
                    break
                if d == "\\":
                    if i + 1 < n and s[i + 1] == "\n":
                        i += 2
                        continue
                    if i + 1 >= n:
                        i += 1
                        continue
                    ch, i = _read_escape(s, i + 1)
                    buf.append(ch)
                    continue
                buf.append(d)
                i += 1
            else:
                pass
            toks.append(Tok("bad" if bad else "string", "".join(buf)))
            continue
        if c == "#":
            if i + 1 < n and (_is_ident_char(s[i + 1]) or s[i + 1] == "\\"):
                name, i = _read_name(s, i + 1)
                toks.append(Tok("hash", name))
            else:
                toks.append(Tok("delim", "#"))
                i += 1
            continue
        m = NUM_RE.match(s, i) if c in "0123456789+-." else None
        if m:
            i = m.end()
            value = float(m.group(0))
            if not -1e9 < value < 1e9:  # also catches an infinite value from a huge exponent
                toks.append(Tok("bad", m.group(0)[:20]))
                continue
            if i < n and s[i] == "%":
                toks.append(Tok("perc", m.group(0), value))
                i += 1
            elif _starts_ident(s, i):
                unit, i = _read_name(s, i)
                toks.append(Tok("dim", m.group(0), value, _lower(unit)))
            else:
                toks.append(Tok("num", m.group(0), value))
            continue
        if _starts_ident(s, i):
            name, i = _read_name(s, i)
            if i < n and s[i] == "(":
                i += 1
                if _lower(name) == "url":
                    j = i
                    while j < n and s[j] in " \t\r\n\f":
                        j += 1
                    if j < n and s[j] in "\"'":
                        toks.append(Tok("func", "url"))
                        i = j
                        continue
                    buf = []
                    bad = False
                    while j < n:
                        d = s[j]
                        if d == ")":
                            j += 1
                            break
                        if d in "\"'(" or d in " \t\r\n\f" or ord(d) < 32:
                            bad = True
                            # skip to the closing parenthesis
                            while j < n and s[j] != ")":
                                j += 1
                            j += 1
                            break
                        if d == "\\":
                            ch, j = _read_escape(s, j + 1)
                            buf.append(ch)
                            continue
                        buf.append(d)
                        j += 1
                    toks.append(Tok("bad" if bad else "url", "".join(buf)))
                    i = j
                    continue
                toks.append(Tok("func", _lower(name)))
                continue
            toks.append(Tok("ident", name))
            continue
        if c == "@":
            if _starts_ident(s, i + 1):
                name, i = _read_name(s, i + 1)
                toks.append(Tok("atkw", _lower(name)))
            else:
                toks.append(Tok("delim", "@"))
                i += 1
            continue
        if c in "{}()[];:,":
            toks.append(Tok(c))
            i += 1
            continue
        if c == "\\":
            toks.append(Tok("bad", "\\"))
            i += 1
            continue
        toks.append(Tok("delim", c))
        i += 1
    return toks


# ---- property table. Letters: L length  N number  C colour  A angle  T time  F fr  G gradients  U url  S string
#      X transform functions  E filter functions  P shape functions  B timing functions  R grid functions
#      M comma lists  D slash  K:keywords
GLOBAL_KW = {"inherit", "initial", "unset"}
_BORDER_STYLE = "none solid dashed dotted double hidden"
_BOX = "L"
PROPS = {}


def _def(names, spec):
    for name in names.split():
        PROPS[name] = spec


_def("display", "K:block flex grid inline inline-block inline-flex inline-grid none contents")
_def("position", "K:static relative absolute")
_def("top right bottom left inset width height min-width min-height max-width max-height", "L K:auto none fit-content min-content max-content")
_def("margin margin-top margin-right margin-bottom margin-left", "L K:auto")
_def("padding padding-top padding-right padding-bottom padding-left", "L")
_def("z-index", "N K:auto")
_def("flex", "N L K:auto none")
_def("flex-grow flex-shrink order", "N")
_def("flex-basis", "L K:auto content")
_def("flex-direction", "K:row row-reverse column column-reverse")
_def("flex-wrap", "K:nowrap wrap wrap-reverse")
_def("flex-flow", "K:row row-reverse column column-reverse nowrap wrap wrap-reverse")
_def("justify-content align-content", "K:flex-start flex-end center space-between space-around space-evenly start end stretch normal")
_def("align-items align-self justify-items justify-self place-items place-content place-self",
     "K:flex-start flex-end center baseline stretch start end normal auto space-between space-around space-evenly")
_def("gap row-gap column-gap grid-gap", "L")
_def("grid-template-columns grid-template-rows grid-auto-columns grid-auto-rows", "L F R K:auto none min-content max-content")
_def("grid-column grid-row grid-column-start grid-column-end grid-row-start grid-row-end", "N D K:auto span")
_def("grid-auto-flow", "K:row column dense")
_def("overflow overflow-x overflow-y", "K:visible hidden clip")
_def("object-fit", "K:fill contain cover none scale-down")
_def("object-position transform-origin background-position", "L K:left right top bottom center")
_def("aspect-ratio", "N D K:auto")
_def("box-sizing", "K:border-box content-box")
_def("color background-color border-color border-top-color border-right-color border-bottom-color border-left-color "
     "text-decoration-color caret-color fill stroke", "C")
_def("opacity", "N")
_def("font-size letter-spacing word-spacing text-indent", "L K:normal")
_def("font-weight", "N K:normal bold bolder lighter")
_def("font-style", "K:normal italic oblique")
_def("font-variant-numeric font-variant", "K:normal tabular-nums lining-nums oldstyle-nums small-caps proportional-nums")
_def("line-height", "N L K:normal")
_def("text-align", "K:left right center justify start end")
_def("text-transform", "K:none uppercase lowercase capitalize")
_def("text-decoration text-decoration-line", "C K:none underline line-through solid")
_def("text-overflow", "K:clip ellipsis")
_def("white-space", "K:normal nowrap pre pre-wrap pre-line")
_def("word-break", "K:normal break-all keep-all break-word")
_def("overflow-wrap word-wrap", "K:normal break-word anywhere")
_def("vertical-align", "L K:baseline top middle bottom text-top text-bottom sub super")
_def("direction", "K:ltr rtl")
_def("unicode-bidi", "K:normal embed isolate bidi-override isolate-override plaintext")
_def("text-shadow box-shadow", "L C M K:none inset")
_def("-webkit-line-clamp line-clamp", "N K:none")
_def("background", "L C G U M D K:none no-repeat repeat repeat-x repeat-y space round cover contain left right top center bottom border-box padding-box content-box")
_def("background-image", "G U M K:none")
_def("background-size", "L M K:auto cover contain")
_def("background-repeat", "M K:repeat repeat-x repeat-y no-repeat space round")
_def("background-clip background-origin", "K:border-box padding-box content-box text")
_def("background-blend-mode mix-blend-mode", "K:normal multiply screen overlay darken lighten color-dodge color-burn soft-light hard-light difference exclusion")
_def("border", "L C K:" + _BORDER_STYLE + " thin medium thick")
_def("border-top border-right border-bottom border-left", "L C K:" + _BORDER_STYLE + " thin medium thick")
_def("border-width border-top-width border-right-width border-bottom-width border-left-width", "L K:thin medium thick")
_def("border-style border-top-style border-right-style border-bottom-style border-left-style", "K:" + _BORDER_STYLE)
_def("border-radius border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius "
     "border-start-start-radius border-start-end-radius border-end-start-radius border-end-end-radius", "L D")
_def("transform", "X L N A K:none")
_def("translate rotate scale", "L N A K:none")
_def("clip-path", "P L K:none at closest-side farthest-side nonzero evenodd round")
_def("filter backdrop-filter", "E L N A K:none")
_def("pointer-events", "K:none")
_def("content", "S K:none normal")
_def("font-family", "S M K:serif sans-serif monospace cursive system-ui")
_def("animation", "N T B K:none normal reverse alternate alternate-reverse forwards backwards both running paused ease ease-in ease-out ease-in-out linear step-start step-end")
_def("animation-name", "M K:none")
_def("animation-duration animation-delay", "T M")
_def("animation-iteration-count", "N M")
_def("animation-timing-function", "B M K:ease ease-in ease-out ease-in-out linear step-start step-end")
_def("animation-fill-mode", "M K:none forwards backwards both")
_def("animation-direction", "M K:normal reverse alternate alternate-reverse")
_def("animation-play-state", "K:running paused")
_def("will-change", "K:auto transform opacity")
_def("visibility", "K:visible hidden")
_def("isolation", "K:auto isolate")
_def("writing-mode", "K:horizontal-tb vertical-rl vertical-lr")

CARD_FONT_FAMILIES = {
    "anton", "bebas neue", "cairo", "caveat", "cormorant garamond", "dm sans", "dm serif display", "dancing script",
    "fraunces", "jetbrains mono", "lora", "manrope", "montserrat", "nunito", "oswald", "outfit", "playfair display",
    "plus jakarta sans", "poppins", "press start 2p", "sora", "space grotesk", "space mono", "syne", "tajawal",
    "ibm plex sans arabic", "inter", "arial", "helvetica", "georgia", "times new roman", "courier new",
}
COLOUR_FUNCS = {"rgb", "rgba", "hsl", "hsla"}
GRADIENT_FUNCS = {"linear-gradient", "radial-gradient", "conic-gradient", "repeating-linear-gradient",
                  "repeating-radial-gradient", "repeating-conic-gradient"}
MATH_FUNCS = {"calc", "min", "max", "clamp"}
TRANSFORM_FUNCS = {"translate", "translatex", "translatey", "scale", "scalex", "scaley", "rotate", "skew", "skewx", "skewy"}
FILTER_FUNCS = {"blur", "brightness", "contrast", "grayscale", "saturate", "hue-rotate", "drop-shadow", "opacity", "sepia", "invert"}
SHAPE_FUNCS = {"polygon", "circle", "ellipse", "inset"}
TIMING_FUNCS = {"cubic-bezier", "steps"}
GRID_FUNCS = {"repeat", "minmax", "fit-content"}
EXTRA_KEYWORDS = {"to", "top", "bottom", "left", "right", "center", "at", "closest-side", "farthest-side", "closest-corner",
                  "farthest-corner", "in", "circle", "ellipse", "from", "auto", "span", "auto-fill", "auto-fit", "min-content",
                  "max-content", "round", "evenodd", "nonzero"}
SIZE_UNITS = {"cqw", "em"}
ANGLE_UNITS = {"deg", "turn", "rad", "grad"}
TIME_UNITS = {"s", "ms"}
FONT_WEIGHT_MAX = 1000


class _Css:
    def __init__(self, face_id, allowed_media, warn):
        self.face_id = face_id
        self.allowed_media = list(allowed_media)
        self.w = warn
        self.data = [0]
        self.prefix = f".cfl .face.cf-{face_id}"
        self.keyframe_prefix = f"cf{face_id}-"
        self.keyframes_seen = set()
        self.rules = 0

    # ---- values
    def animation_value(self, prop, toks):
        spec = PROPS[prop]
        letters, _, kws = spec.partition("K:")
        return self._animation(prop, toks, set(letters.replace(" ", "")), set(kws.split()) | GLOBAL_KW)

    def _seq(self, toks, flags, kw, prop, depth, in_calc=False):
        """Serialise a token list, or None. Whitespace is collapsed to one space; commas and slashes only where allowed."""
        out = []
        for tk in toks:
            t = tk.t
            if t == "ws":
                if out and out[-1] != " ":
                    out.append(" ")
                continue
            if t == "ident":
                name = tk.v
                low = _lower(name)
                if not re.fullmatch(r"-?[A-Za-z_][A-Za-z0-9_-]*", name):
                    return None
                if prop == "font-family":
                    return None  # font families are strings or handled below
                if low in kw or low in GLOBAL_KW or (low in EXTRA_KEYWORDS and ("G" in flags or "P" in flags or "R" in flags or "X" in flags)):
                    out.append(low)
                elif "C" in flags and low in NAMED_COLOURS:
                    out.append(low)
                elif in_calc and low in ("e", "pi"):
                    out.append(low)
                else:
                    return None
                continue
            if t == "num":
                if "N" in flags or tk.n == 0 or in_calc:
                    out.append(_num(tk.n))
                else:
                    return None
                continue
            if t == "perc":
                if "L" in flags or in_calc or "G" in flags or "P" in flags or "E" in flags or "R" in flags or "X" in flags or "C" in flags:
                    out.append(_num(tk.n) + "%")
                else:
                    return None
                continue
            if t == "dim":
                unit = tk.u
                ok = (
                    (unit in SIZE_UNITS and ("L" in flags or in_calc or "G" in flags or "P" in flags or "E" in flags or "R" in flags or "X" in flags))
                    or (unit in ANGLE_UNITS and ("A" in flags or "G" in flags or "X" in flags or "E" in flags))
                    or (unit in TIME_UNITS and "T" in flags)
                    or (unit == "fr" and "F" in flags)
                )
                if not ok:
                    return None
                out.append(_num(tk.n) + unit)
                continue
            if t == "hash":
                if "C" in flags or "G" in flags:
                    if HEX_COLOUR_RE.match("#" + tk.v):
                        out.append("#" + _lower(tk.v))
                        continue
                return None
            if t == "string":
                if "S" not in flags or len(tk.v) > 80 or re.search(r"[\x00-\x1f\x7f]", tk.v):
                    return None
                if prop == "font-family":
                    if _lower(_strip(tk.v)) not in CARD_FONT_FAMILIES:
                        return None
                out.append('"' + tk.v.replace("\\", "\\\\").replace('"', '\\"') + '"')
                continue
            if t == ",":
                if "M" in flags or depth > 0:
                    out.append(",")
                    continue
                return None
            if t == "delim":
                if tk.v == "/" and ("D" in flags or depth > 0 or in_calc):
                    out.append("/")
                    continue
                if tk.v in "+-*" and in_calc:
                    out.append(" " + tk.v + " ")
                    continue
                return None
            if t == "url":
                if "U" not in flags:
                    return None
                u = self._url(tk.v)
                if u is None:
                    return None
                out.append(u)
                continue
            if t == "func":
                return None  # functions are grouped before this point (see _group)
            return None
        return out

    def _animation(self, prop, toks, flags, kw):
        """Animation values: names must start with the face id prefix; no infinite loops; at most MAX_ANIMATION_SECONDS."""
        items = [tk for tk in toks if tk.t != "ws"]
        # shorthand with a comma list is refused to keep the time limit checkable
        depth = 0
        for tk in items:
            if tk.t == "func" or tk.t == "(":
                depth += 1
            elif tk.t == ")":
                depth -= 1
            elif tk.t == "," and depth == 0 and prop not in ("animation-name",):
                return None
        if prop == "animation-iteration-count":
            ok = all(tk.t == "num" and 0 <= tk.n <= 3 for tk in items if tk.t != ",")
            return " ".join(_num(tk.n) for tk in items) if ok and items else None
        if prop in ("animation-duration", "animation-delay"):
            if len(items) != 1 or items[0].t != "dim" or items[0].u not in TIME_UNITS:
                return None
            seconds = items[0].n / (1000 if items[0].u == "ms" else 1)
            if seconds < 0 or seconds > (MAX_ANIMATION_SECONDS if prop == "animation-duration" else 2):
                return None
            return _num(items[0].n) + items[0].u
        if prop == "animation-name":
            names = []
            for tk in items:
                if tk.t == ",":
                    continue
                if tk.t != "ident" or not (tk.v == "none" or tk.v.startswith(self.keyframe_prefix)) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", tk.v):
                    return None
                names.append(tk.v)
            return ",".join(names) if names else None
        # shorthand and the keyword properties
        flat = []
        i = 0
        duration = delay = None
        count = 1.0
        name = None
        while i < len(items):
            tk = items[i]
            if tk.t == "dim" and tk.u in TIME_UNITS:
                seconds = tk.n / (1000 if tk.u == "ms" else 1)
                if duration is None:
                    duration = seconds
                elif delay is None:
                    delay = seconds
                else:
                    return None
                flat.append(_num(tk.n) + tk.u)
            elif tk.t == "num":
                if not 0 <= tk.n <= 3:
                    return None
                count = tk.n
                flat.append(_num(tk.n))
            elif tk.t == "ident":
                low = _lower(tk.v)
                if low == "infinite":
                    return None
                if low in kw or low in GLOBAL_KW:
                    flat.append(low)
                elif tk.v.startswith(self.keyframe_prefix) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", tk.v):
                    name = tk.v
                    flat.append(tk.v)
                else:
                    return None
            elif tk.t == "func" and tk.v in TIMING_FUNCS:
                j, inner = _grab_args(items, i + 1)
                if inner is None:
                    return None
                parts = self._seq(inner, {"N"}, set(), prop, 1)
                if parts is None:
                    return None
                flat.append(f"{tk.v}({''.join(parts)})")
                i = j
                continue
            else:
                return None
            i += 1
        if prop == "animation" and (duration is None or duration > MAX_ANIMATION_SECONDS or (delay or 0) > 2
                                    or duration * max(count, 1) > MAX_ANIMATION_SECONDS):
            return None
        return " ".join(flat) if flat else None

    def _url(self, raw):
        v = _strip(raw)
        if len(v) > MAX_DATA_BYTES:
            return None
        if DATA_IMAGE_RE.match(v) or DATA_SVG_RE.match(v):
            if self.data[0] + len(v) > MAX_DATA_BYTES:
                return None
            self.data[0] += len(v)
            return 'url("' + v.replace('"', "%22") + '")'
        if v.startswith("//") or not re.match(r"^(?:https?://[A-Za-z0-9.:\[\]-]+)?/[A-Za-z0-9_./~%-]{1,300}\Z", v):
            return None
        path = urlsplit(v).path
        if any(path == urlsplit(a).path for a in self.allowed_media):
            return 'url("' + v + '")'
        return None

    # ---- grouping: turn function tokens into one nested serialised piece
    def _simplify(self, prop, toks, depth=0):
        """Replace each function (with its arguments) in `toks` by a "raw" token holding its checked serialisation."""
        spec = PROPS[prop]
        letters = spec.partition("K:")[0].replace(" ", "")
        flags = set(letters)
        out = []
        i = 0
        while i < len(toks):
            tk = toks[i]
            if tk.t == "func":
                j, inner = _grab_args(toks, i + 1)
                if inner is None or depth > 5:
                    return None
                name = tk.v
                text = self._function(prop, name, inner, flags, depth)
                if text is None:
                    return None
                out.append(Tok("raw", text))
                i = j
                continue
            if tk.t in ("(", ")", "[", "]", "{", "}", ";", ":", "bad", "atkw"):
                return None
            out.append(tk)
            i += 1
        return out

    def _function(self, prop, name, inner, flags, depth):
        low = _lower(name)
        arg_flags = set(flags)
        in_calc = False
        if low == "url":
            items = [t for t in inner if t.t != "ws"]
            if "U" in flags and len(items) == 1 and items[0].t == "string":
                return self._url(items[0].v)
            return None
        if low in COLOUR_FUNCS:
            if "C" not in flags and "G" not in flags and "E" not in flags:
                return None
            arg_flags = {"N", "L", "A"}
            in_calc = False
            body = self._simplify_args(prop, inner, arg_flags, depth, extra_kw={"none"})
            if body is None:
                return None
            return f"{low}({body})"
        if low in MATH_FUNCS:
            if not ({"L", "N", "A", "T"} & flags):
                return None
            body = self._simplify_args(prop, inner, flags | {"L", "N"}, depth, in_calc=True)
            return None if body is None else f"{low}({body})"
        if low == "var":
            items = [t for t in inner if t.t != "ws"]
            if len(items) == 1 and items[0].t == "ident" and VAR_RE.match(f"var({items[0].v})"):
                if prop in ("font-family",) or "C" in flags or "L" in flags or "G" in flags or "S" in flags:
                    return f"var({items[0].v})"
            return None
        if low in GRADIENT_FUNCS:
            if "G" not in flags:
                return None
            body = self._simplify_args(prop, inner, {"C", "L", "A", "N", "G"}, depth)
            return None if body is None else f"{low}({body})"
        if low in TRANSFORM_FUNCS:
            if "X" not in flags:
                return None
            body = self._simplify_args(prop, inner, {"L", "N", "A"}, depth)
            return None if body is None else f"{low}({body})"
        if low in FILTER_FUNCS:
            if "E" not in flags:
                return None
            body = self._simplify_args(prop, inner, {"L", "N", "A", "C"}, depth)
            if body is None:
                return None
            if low == "blur":
                m = re.fullmatch(r"(-?[0-9.]+)(?:cqw|em)?", body)
                if not m or float(m.group(1)) > 6:
                    return None
            return f"{low}({body})"
        if low in SHAPE_FUNCS:
            if "P" not in flags:
                return None
            body = self._simplify_args(prop, inner, {"L", "N", "P"}, depth, extra_kw=EXTRA_KEYWORDS)
            return None if body is None else f"{low}({body})"
        if low in TIMING_FUNCS:
            return None
        if low in GRID_FUNCS:
            if "R" not in flags:
                return None
            body = self._simplify_args(prop, inner, {"L", "F", "N", "R"}, depth, extra_kw=EXTRA_KEYWORDS)
            return None if body is None else f"{low}({body})"
        return None

    def _simplify_args(self, prop, inner, flags, depth, in_calc=False, extra_kw=()):
        toks = self._simplify(prop, inner, depth + 1)
        if toks is None:
            return None
        flags = set(flags)
        kw = set(extra_kw)
        if "G" in flags or "C" in flags:
            kw |= {"to", "top", "bottom", "left", "right", "center", "at", "closest-side", "farthest-side", "closest-corner",
                   "farthest-corner", "in", "circle", "ellipse", "from"}
        parts = self._seq_raw(toks, flags, kw, prop, depth + 1, in_calc)
        return None if parts is None else re.sub(r"[ \t\n\r\f]+", " ", "".join(parts)).strip(" ")

    def _seq_raw(self, toks, flags, kw, prop, depth, in_calc):
        out = []
        for tk in toks:
            if tk.t == "raw":
                out.append(tk.v)
                continue
            if tk.t == "ws":
                out.append(" ")
                continue
            piece = self._seq([tk], flags | ({"C"} if "G" in flags else set()), kw, prop, depth, in_calc)
            if piece is None:
                return None
            out.extend(piece)
        return out

    # ---- declarations
    def declarations(self, toks, keyframe=False):
        """Parse the inside of a `{ }` block into cleaned `name:value` strings."""
        out = []
        i = 0
        n = len(toks)
        while i < n:
            while i < n and toks[i].t in ("ws", ";"):
                i += 1
            if i >= n:
                break
            # one declaration: up to the next top-level ";"
            j = i
            depth = 0
            nested = False
            while j < n:
                t = toks[j].t
                if t in ("(", "[") or t == "func":
                    depth += 1
                elif t in (")", "]"):
                    depth = max(0, depth - 1)
                elif t == "{":
                    nested = True
                    break
                elif t == ";" and depth == 0:
                    break
                j += 1
            if nested:
                self.w.add("nested_rule", "Removed a nested rule inside a declaration block: nesting is not allowed.")
                k = _skip_block(toks, j)
                i = k
                continue
            decl = toks[i:j]
            i = j + 1
            cleaned = self.declaration(decl)
            if cleaned:
                out.append(cleaned)
        return out

    def declaration(self, decl):
        items = [t for t in decl]
        while items and items[0].t == "ws":
            items.pop(0)
        if len(items) < 3 or items[0].t != "ident":
            self.w.add("bad_declaration", "Removed a declaration that could not be read.")
            return None
        name = _lower(items[0].v)
        k = 1
        while k < len(items) and items[k].t == "ws":
            k += 1
        if k >= len(items) or items[k].t != ":":
            self.w.add("bad_declaration", "Removed a declaration that could not be read.")
            return None
        value = items[k + 1:]
        # strip !important
        stripped = [t for t in value if t.t != "ws"]
        if len(stripped) >= 2 and stripped[-1].t == "ident" and _lower(stripped[-1].v) == "important" \
                and stripped[-2].t == "delim" and stripped[-2].v == "!":
            idx = max(m for m, t in enumerate(value) if t.t == "delim" and t.v == "!")
            value = value[:idx]
            self.w.add("important", "Removed !important: it is not needed and not allowed.")
        if name.startswith("--"):
            self.w.add("custom_property", f"Removed the custom property {name}: only the face colours may be used with var().", name=name)
            return None
        if name not in PROPS:
            self.w.add("property", f"Removed the property \"{name}\": it is not on the list of allowed properties.", name=name)
            return None
        if any(t.t == "bad" for t in value):
            self.w.add("bad_value", f"Removed {name}: the value could not be read.", name=name)
            return None
        # the animation shorthand and the keyframe names are checked in _animation, which handles functions itself
        if name.startswith("animation"):
            text = self.animation_value(name, value)
        else:
            simple = self._simplify(name, value)
            text = None if simple is None else self._finish(name, simple)
        if text is None:
            self.w.add("value", f"Removed {name}: the value is not allowed (check units, colours and functions).", name=name)
            return None
        return f"{name}:{text}"

    def _finish(self, prop, simple):
        spec = PROPS[prop]
        letters, _, kws = spec.partition("K:")
        flags = set(letters.replace(" ", ""))
        kw = set(kws.split()) | GLOBAL_KW
        if prop == "font-family":
            parts = []
            for tk in simple:
                if tk.t == "ws":
                    continue
                if tk.t == "raw":
                    parts.append(tk.v)
                elif tk.t == ",":
                    parts.append(",")
                elif tk.t == "string":
                    if _lower(_strip(tk.v)) not in CARD_FONT_FAMILIES:
                        return None
                    parts.append('"' + tk.v.replace("\\", "").replace('"', "") + '"')
                elif tk.t == "ident" and _lower(tk.v) in kw:
                    parts.append(_lower(tk.v))
                else:
                    return None
            return "".join(parts) or None
        parts = self._seq_raw(simple, flags, kw, prop, 0, False)
        if parts is None:
            return None
        text = re.sub(r"[ \t\n\r\f]+", " ", "".join(parts)).strip(" ")
        if not text:
            return None
        if prop == "z-index" and re.fullmatch(r"-?[0-9]+", text) and not -2 <= int(text) <= 20:
            return None
        if prop == "font-weight" and re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", text) and not 1 <= float(text) <= FONT_WEIGHT_MAX:
            return None
        if prop == "opacity" and re.fullmatch(r"-?[0-9]*\.?[0-9]+", text) and not 0 <= float(text) <= 1:
            return None
        if prop == "content" and "(" in text:
            return None
        return text

    # ---- selectors
    def selector_list(self, toks):
        """Split a prelude into selectors and return the scoped ones as strings."""
        groups = [[]]
        depth = 0
        for t in toks:
            if t.t in ("(", "func"):
                depth += 1
            elif t.t == ")":
                depth = max(0, depth - 1)
            if t.t == "," and depth == 0:
                groups.append([])
            else:
                groups[-1].append(t)
        out = []
        for g in groups:
            s = self.selector(g)
            if s is None:
                self.w.add("selector", "Removed a selector that is not allowed (only classes, simple tags and a few pseudo-classes).")
            else:
                out.append(s)
        return out

    def _unscope(self, items):
        """A selector that already starts with this face's own scope (cleaned text being cleaned again) is read as :scope."""
        want = [("delim", "."), ("ident", "cfl"), ("ws", ""), ("delim", "."), ("ident", "face"), ("delim", "."), ("ident", f"cf-{self.face_id}")]
        if len(items) >= len(want) and all(
            t.t == k and (not v or t.v == v) for t, (k, v) in zip(items, want)
        ):
            return [Tok(":"), Tok("ident", "scope")] + items[len(want):]
        return items

    def selector(self, toks):
        items = self._unscope(list(toks))
        while items and items[0].t == "ws":
            items.pop(0)
        while items and items[-1].t == "ws":
            items.pop()
        if not items:
            return None
        parts = []
        i = 0
        n = len(items)
        first = True
        pending = " "
        root_only = False
        while i < n:
            compound, i, ok = self._compound(items, i, first)
            if not ok:
                return None
            if first and compound == ":scope":
                root_only = True
                text = ""
            else:
                if first and compound.startswith(":scope"):
                    text = compound[len(":scope"):]
                    root_only = True
                else:
                    text = compound
                if not first or not root_only:
                    pass
            if first:
                parts.append(("", text, root_only))
            else:
                parts.append((pending, text, False))
            first = False
            # combinator
            saw_ws = False
            while i < n and items[i].t == "ws":
                saw_ws = True
                i += 1
            if i >= n:
                break
            if items[i].t == "delim" and items[i].v in ">+~":
                pending = f" {items[i].v} "
                i += 1
                while i < n and items[i].t == "ws":
                    i += 1
                if i >= n:
                    return None
            elif saw_ws:
                pending = " "
            else:
                return None
        # build
        sel = self.prefix
        started = False
        for k, (comb, text, root) in enumerate(parts):
            if k == 0:
                if root:
                    sel += text
                else:
                    sel += " " + text
            else:
                sel += comb + text
        return sel

    def _compound(self, items, i, first):
        n = len(items)
        out = []
        start = i
        t = items[i]
        # type selector
        if t.t == "ident":
            low = _lower(t.v)
            tag = low if low in HTML_TAGS else (SVG_TAGS.get(low))
            if tag is None:
                return "", i, False
            out.append(tag)
            i += 1
        elif t.t == "delim" and t.v == "*":
            out.append("*")
            i += 1
        while i < n:
            t = items[i]
            if t.t == "delim" and t.v == "." and i + 1 < n and items[i + 1].t == "ident":
                cname = items[i + 1].v
                if not CLASS_RE.match(cname):
                    return "", i, False
                out.append("." + cname)
                i += 2
            elif t.t == ":":
                if i + 1 < n and items[i + 1].t == ":":
                    # pseudo-element
                    if i + 2 < n and items[i + 2].t == "ident" and _lower(items[i + 2].v) in ("before", "after"):
                        out.append("::" + _lower(items[i + 2].v))
                        i += 3
                        if i < n and items[i].t not in ("ws",):
                            return "", i, False
                        continue
                    return "", i, False
                if i + 1 < n and items[i + 1].t == "ident":
                    name = _lower(items[i + 1].v)
                    if name == "scope" and first and not out:
                        out.append(":scope")
                        i += 2
                        continue
                    if name in ("first-child", "last-child", "only-child", "first-of-type", "last-of-type", "empty"):
                        out.append(":" + name)
                        i += 2
                        continue
                    if name in ("before", "after"):
                        out.append("::" + name)
                        i += 2
                        continue
                    return "", i, False
                if i + 1 < n and items[i + 1].t == "func":
                    fname = items[i + 1].v
                    j, inner = _grab_args(items, i + 2)
                    if inner is None:
                        return "", i, False
                    if fname in ("nth-child", "nth-last-child", "nth-of-type", "nth-last-of-type"):
                        text = _strip("".join(_nth_piece(x) for x in inner if x.t != "ws"))
                        if text is None or not re.fullmatch(r"(?:even|odd|[+-]?\d*n(?:[+-]\d+)?|[+-]?\d+)", text.replace(" ", "")):
                            return "", i, False
                        out.append(f":{fname}({text})")
                        i = j
                        continue
                    if fname == "not":
                        body = [x for x in inner if x.t != "ws"]
                        if len(body) == 2 and body[0].t == "delim" and body[0].v == "." and body[1].t == "ident" and CLASS_RE.match(body[1].v):
                            out.append(f":not(.{body[1].v})")
                        elif len(body) == 1 and body[0].t == "ident" and _lower(body[0].v) in HTML_TAGS | set(SVG_TAGS):
                            low = _lower(body[0].v)
                            out.append(f":not({SVG_TAGS.get(low, low)})")
                        else:
                            return "", i, False
                        i = j
                        continue
                return "", i, False
            else:
                break
        if i == start:
            return "", i, False
        return "".join(out), i, True

    # ---- the style sheet
    def sheet(self, toks):
        out = []
        i = 0
        n = len(toks)
        while i < n:
            while i < n and toks[i].t == "ws":
                i += 1
            if i >= n:
                break
            if toks[i].t == "atkw":
                i = self._at_rule(toks, i, out)
                continue
            j = i
            while j < n and toks[j].t != "{":
                j += 1
            prelude = toks[i:j]
            if j >= n:
                self.w.add("unfinished", "Removed a rule that has no opening brace.")
                break
            end = _skip_block(toks, j)
            block = toks[j + 1:end - 1] if end - 1 > j and toks[end - 1].t == "}" else toks[j + 1:end]
            i = end
            self.rules += 1
            if self.rules > MAX_RULES:
                self.w.add("too_many_rules", f"Stopped after {MAX_RULES} rules.", max=MAX_RULES)
                break
            if any(t.t in ("}", "atkw", "bad") for t in prelude):
                self.w.add("rule_selector", "Removed a rule whose selector could not be read.")
                continue
            selectors = self.selector_list(prelude)
            if not selectors:
                continue
            decls = self.declarations(block)
            if decls:
                out.append(",".join(selectors) + "{" + ";".join(decls) + "}")
        return "\n".join(out)

    def _at_rule(self, toks, i, out):
        name = toks[i].v
        n = len(toks)
        j = i + 1
        while j < n and toks[j].t not in ("{", ";"):
            j += 1
        if name == "keyframes" and j < n and toks[j].t == "{":
            prelude = [t for t in toks[i + 1:j] if t.t != "ws"]
            end = _skip_block(toks, j)
            inner = toks[j + 1:end - 1] if toks[end - 1].t == "}" else toks[j + 1:end]
            if (len(prelude) == 1 and prelude[0].t == "ident" and prelude[0].v.startswith(self.keyframe_prefix)
                    and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", prelude[0].v) and prelude[0].v not in self.keyframes_seen):
                steps = self._keyframe_steps(inner)
                if steps:
                    self.keyframes_seen.add(prelude[0].v)
                    out.append(f"@keyframes {prelude[0].v}{{{steps}}}")
            else:
                self.w.add("keyframes_name", f"Removed @keyframes: its name must start with \"{self.keyframe_prefix}\".", prefix=self.keyframe_prefix)
            return end
        label = "@" + name
        self.w.add("at_rule", f"Removed {label}: only @keyframes is allowed.", name=label)
        if j < n and toks[j].t == "{":
            return _skip_block(toks, j)
        return j + 1

    def _keyframe_steps(self, toks):
        out = []
        i = 0
        n = len(toks)
        while i < n:
            while i < n and toks[i].t == "ws":
                i += 1
            if i >= n:
                break
            j = i
            while j < n and toks[j].t != "{":
                j += 1
            if j >= n:
                break
            end = _skip_block(toks, j)
            block = toks[j + 1:end - 1] if toks[end - 1].t == "}" else toks[j + 1:end]
            sel = []
            for t in toks[i:j]:
                if t.t == "ws":
                    continue
                if t.t == "ident" and _lower(t.v) in ("from", "to"):
                    sel.append(_lower(t.v))
                elif t.t == "perc" and 0 <= t.n <= 100:
                    sel.append(_num(t.n) + "%")
                elif t.t == ",":
                    sel.append(",")
                else:
                    sel = None
                    break
            i = end
            if not sel or sel[0] == "," or sel[-1] == ",":
                self.w.add("keyframes_step", "Removed a keyframe step that could not be read.")
                continue
            decls = [d for d in self.declarations(block) if not d.startswith("animation")]
            if decls:
                out.append("".join(sel) + "{" + ";".join(decls) + "}")
        return "".join(out)


def _nth_piece(t):
    if t.t == "num":
        return _num(t.n)
    if t.t == "dim" and t.u == "n":
        return _num(t.n) + "n"
    if t.t == "ident":
        return _lower(t.v)
    if t.t == "delim" and t.v in "+-":
        return t.v
    return "\x00"


def _num(x):
    if x == int(x):
        return str(int(x))
    text = f"{x:.4f}".rstrip("0").rstrip(".")
    return text if text not in ("-0", "") else "0"


def _grab_args(toks, i):
    """Tokens after an opening function token: returns (index after the closing paren, inner tokens) or (i, None)."""
    depth = 1
    j = i
    n = len(toks)
    while j < n:
        t = toks[j].t
        if t in ("(", "func"):
            depth += 1
        elif t == ")":
            depth -= 1
            if depth == 0:
                return j + 1, toks[i:j]
        elif t == "{" or t == "}":
            return i, None
        j += 1
    return i, None


def _skip_block(toks, i):
    """toks[i] is `{`: the index just after the matching `}` (or the end)."""
    depth = 0
    j = i
    n = len(toks)
    while j < n:
        if toks[j].t == "{":
            depth += 1
        elif toks[j].t == "}":
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return n


def sanitize_css(src, face_id, allowed_media=(), warn=None, data_start=0):
    w = warn or _Warn("css")
    res = Result()
    if not isinstance(src, str):
        res.errors.append({"where": "css", "code": "type", "message": "The CSS must be text."})
        return res
    if _text_bytes(src) > MAX_CSS_BYTES:
        res.errors.append({"where": "css", "code": "too_large", "message": f"The CSS is larger than {MAX_CSS_BYTES // 1024} KB."})
        return res
    src = _strip_controls(src)
    ctx = _Css(face_id, allowed_media, w)
    ctx.data[0] = data_start
    toks = _tokenise_css(src)
    res.value = ctx.sheet(toks)
    res.warnings = w.out()
    res.data_bytes = ctx.data[0]
    if ctx.data[0] > MAX_DATA_BYTES:
        res.errors.append({"where": "css", "code": "too_much_data", "message": "Embedded pictures are larger than 200 KB in total."})
    return res


def sanitize_face(template, css, face_id, allowed_media=()):
    """Clean both parts of a face. Returns (template, css, warnings, errors)."""
    t = sanitize_template(template, allowed_media)
    c = sanitize_css(css, face_id, allowed_media, data_start=t.data_bytes)
    errors = t.errors + c.errors
    if t.data_bytes + (c.data_bytes - t.data_bytes) > MAX_DATA_BYTES and not any(e["code"] == "too_much_data" for e in errors):
        errors.append({"where": "template", "code": "too_much_data", "message": "Embedded pictures are larger than 200 KB in total."})
    return t.value, c.value, t.warnings + c.warnings, errors
