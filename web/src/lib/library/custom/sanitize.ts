// The safe template language of a custom card face: an allowlist sanitiser for the HTML subset and the CSS subset.
//
// This is a line-for-line port of backend/designs/sanitize.py, which is authoritative (a face is saved only in the form
// the backend returns). The renderer runs this again before it draws a stored face, and the studio runs it on every
// keystroke for the live preview. Both read the same corpus (backend/tests/sanitize_corpus.json), so they stay in step.
//
// Nothing here executes or evaluates anything. The input is cut into tokens, each token is checked against a short list
// of what is allowed, and the output is written again from the checked pieces (never copied), so an odd input can only
// get shorter, never stranger. Whatever is removed is reported as a warning with a code and the values it mentions, so a
// page can word it in any language.

export const MAX_TEMPLATE_BYTES = 60 * 1024;
export const MAX_CSS_BYTES = 120 * 1024;
export const MAX_DATA_BYTES = 200 * 1024;
const MAX_DEPTH = 20;
const MAX_ELEMENTS = 500;
const MAX_RULES = 400;
const MAX_ANIMATION_SECONDS = 5.0;

export const TEXT_PLACEHOLDERS = ["name", "first", "last", "title", "company", "address", "phone", "email", "web", "initials"] as const;
export const BLOCK_PLACEHOLDERS = ["photo", "qr", "logo", "symbol", "phone_line", "email_line", "web_line", "address_line", "lines"] as const;
export const PLACEHOLDERS: readonly string[] = [...TEXT_PLACEHOLDERS, ...BLOCK_PLACEHOLDERS];
export const CONDITIONS: readonly string[] = PLACEHOLDERS;

export interface SanitizeWarning {
  where: "template" | "css";
  code: string;
  message: string;
  count: number;
  params: Record<string, string | number>;
}
export interface SanitizeError {
  where: "template" | "css";
  code: string;
  message: string;
}
export interface SanitizeResult {
  value: string;
  warnings: SanitizeWarning[];
  errors: SanitizeError[];
  dataBytes: number;
}

// ---------------------------------------------------------------- tables
const HTML_TAGS = new Set(["div", "span", "p", "i", "b", "small", "br", "img"]);
const SVG_TAGS: Record<string, string> = {
  svg: "svg", g: "g", defs: "defs", path: "path", rect: "rect", circle: "circle", ellipse: "ellipse", line: "line", polyline: "polyline",
  polygon: "polygon", lineargradient: "linearGradient", radialgradient: "radialGradient", stop: "stop", clippath: "clipPath", mask: "mask",
};
const SVG_LEAVES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "stop"]);
const VOID = new Set(["br", "img"]);
const DROP_CONTENT = new Set([
  "script", "style", "iframe", "object", "embed", "template", "noscript", "textarea", "title", "head", "xmp", "plaintext", "noembed", "noframes",
  "frameset", "applet", "math", "foreignobject", "use", "image", "animate", "animatetransform", "animatemotion", "set", "audio", "video", "canvas",
  "select", "option", "svg:script", "link", "meta", "base", "form", "input", "button", "frame", "marquee", "bgsound", "dialog",
]);
const RESERVED_CLASSES = new Set([
  "card", "inner", "face", "back", "flipped", "stg", "pg", "cfl", "tpf", "tpb", "colg", "copatw", "coband", "cobg", "cobandf", "cohead", "dv",
  "tabs3", "foot", "cotpl", "cobgp", "copg", "mea", "hasfont",

  // names the dashboard's own stylesheet uses; they would leak its styling into the face
  "app", "av", "bar", "bars", "btn", "byline", "cam", "chip", "chipb", "chips", "clrs", "copybox", "cp", "cr", "d", "detg", "device", "dg", "dg2", "dgv", "dlg", "dn", "dsz", "edit", "empty", "err", "eyebrow", "faceg", "fg", "g2", "g3", "gal", "grow", "grp", "head", "hint", "iconsgrid", "ini", "ipick", "irow", "kpi", "kpis", "langpick", "legend", "li", "linkbtn", "list", "logo", "ltr", "main", "mono", "morepanel", "mq", "nav", "nfc", "notice", "only-sm", "opt", "optrow", "pane", "panel", "photo", "pick", "pill", "plan", "plans", "plat", "plats", "pr", "presets", "prow", "qrbig", "qrcard", "qrx", "row", "saved", "scanwrap", "scr", "search", "sechead", "seg", "sh", "sheet", "side", "skeleton", "split", "stage", "strip", "sub", "sw", "swatches", "switch", "tab", "tabs", "th", "themes", "tile", "toast", "toggle", "top", "topbar", "trow", "two", "up", "upsell", "usage", "vcf", "via", "view", "who", "who2", "x",
]);
const CLASS_RE = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,30}$/;
const NUMBER = "-?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)";
const LENGTH_RE = new RegExp(`^${NUMBER}(?:%|em|cqw)?$`);
const PLAIN_NUMBER_RE = new RegExp(`^${NUMBER}$`);
const OFFSET_RE = new RegExp(`^${NUMBER}%?$`);
const UNIT_INTERVAL_RE = /^(?:0?\.[0-9]+|0|1|1\.0+|0\.0+)$/;
const PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9 \t\n\r\f,.+\-eE]{0,24000}$/;
const POINTS_RE = /^[0-9 \t\n\r\f,.+\-eE]{0,8000}$/;
const WS = "[ \\t\\n\\r\\f\\v]";
const TRANSFORM_RE = new RegExp(
  `^(?:${WS}*(?:translate|rotate|scale|skewX|skewY|matrix)${WS}*\\(${WS}*${NUMBER}(?:${WS}*[ ,]${WS}*${NUMBER}){0,5}${WS}*\\)${WS}*)+$`,
);
const VIEWBOX_RE = new RegExp(`^${WS}*${NUMBER}(?:[ \\t\\n\\r\\f\\v,]+${NUMBER}){3}${WS}*$`);
const DASH_RE = new RegExp(`^${NUMBER}(?:[ \\t\\n\\r\\f\\v,]+${NUMBER}){0,7}$`);
const ASPECT_RE = new RegExp(`^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:${WS}+(?:meet|slice))?$`);
const HEX_COLOUR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_COLOUR_RE = new RegExp(
  `^(?:rgba?|hsla?)\\(${WS}*${NUMBER}%?(?:${WS}*[ ,]${WS}*${NUMBER}%?){2}(?:${WS}*[,/]${WS}*${NUMBER}%?)?${WS}*\\)$`,
);
const VAR_RE = /^var\(--(?:cbg|cbg2|cfg|cacc|con|pgbg|pgfg|pacc|pon|ffx)\)$/;
const URL_REF_RE = /^url\(#([A-Za-z][A-Za-z0-9_-]{0,30})\)$/;
const DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const DATA_SVG_RE = /^data:image\/svg\+xml(?:;base64,[A-Za-z0-9+/]+={0,2}|;utf8,[^\x00-\x1f"'<>\\]*|,[A-Za-z0-9%._~!$&*+,;:@/=?#()-]*)$/;
const MEDIA_URL_RE = /^(?:https?:\/\/[A-Za-z0-9.:[\]-]+)?\/[A-Za-z0-9_./~%-]{1,300}$/;

const NAMED_COLOURS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
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
yellowgreen transparent currentcolor`.split(/\s+/),
);

const SVG_ATTRS: Record<string, string> = {
  d: "path", points: "points", transform: "transform", gradienttransform: "transform", viewbox: "viewbox", preserveaspectratio: "aspect",
  "stroke-dasharray": "dash", x: "length", y: "length", x1: "length", y1: "length", x2: "length", y2: "length", cx: "length", cy: "length",
  r: "length", rx: "length", ry: "length", fx: "length", fy: "length", width: "length", height: "length", "stroke-width": "length",
  "stroke-miterlimit": "number", offset: "offset", fill: "paint", stroke: "paint", "stop-color": "paint", opacity: "unit", "fill-opacity": "unit",
  "stroke-opacity": "unit", "stop-opacity": "unit", "clip-path": "ref", mask: "ref", id: "id",
  "stroke-linecap": "enum:butt|round|square", "stroke-linejoin": "enum:miter|round|bevel", "fill-rule": "enum:nonzero|evenodd",
  "clip-rule": "enum:nonzero|evenodd", gradientunits: "enum:userSpaceOnUse|objectBoundingBox", spreadmethod: "enum:pad|reflect|repeat",
  clippathunits: "enum:userSpaceOnUse|objectBoundingBox", maskunits: "enum:userSpaceOnUse|objectBoundingBox",
};
const ATTR_CASE: Record<string, string> = {
  viewbox: "viewBox", preserveaspectratio: "preserveAspectRatio", gradienttransform: "gradientTransform", gradientunits: "gradientUnits",
  spreadmethod: "spreadMethod", clippathunits: "clipPathUnits", maskunits: "maskUnits",
};
const SVG_ELEMENT_ATTRS: Record<string, Set<string>> = {
  svg: new Set(["viewbox", "preserveaspectratio", "width", "height"]),
  g: new Set(["transform", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity", "clip-path", "mask", "id", "fill-rule"]),
  defs: new Set(),
  path: new Set(["d", "transform", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-miterlimit", "opacity", "fill-opacity", "stroke-opacity", "fill-rule", "clip-rule", "clip-path", "mask"]),
  rect: new Set(["x", "y", "width", "height", "rx", "ry", "transform", "fill", "stroke", "stroke-width", "stroke-linejoin", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "clip-path", "mask"]),
  circle: new Set(["cx", "cy", "r", "transform", "fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "clip-path", "mask"]),
  ellipse: new Set(["cx", "cy", "rx", "ry", "transform", "fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "clip-path", "mask"]),
  line: new Set(["x1", "y1", "x2", "y2", "transform", "stroke", "stroke-width", "stroke-linecap", "stroke-dasharray", "opacity", "stroke-opacity", "clip-path", "mask"]),
  polyline: new Set(["points", "transform", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "clip-path", "mask"]),
  polygon: new Set(["points", "transform", "fill", "stroke", "stroke-width", "stroke-linejoin", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "fill-rule", "clip-path", "mask"]),
  lineargradient: new Set(["id", "x1", "y1", "x2", "y2", "gradientunits", "gradienttransform", "spreadmethod"]),
  radialgradient: new Set(["id", "cx", "cy", "r", "fx", "fy", "gradientunits", "gradienttransform", "spreadmethod"]),
  stop: new Set(["offset", "stop-color", "stop-opacity"]),
  clippath: new Set(["id", "clippathunits", "transform"]),
  mask: new Set(["id", "maskunits", "x", "y", "width", "height"]),
};

// ---------------------------------------------------------------- small helpers (ASCII only, so every language agrees)
const lower = (s: string) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
const strip = (s: string) => s.replace(/^[ \t\n\r\f\v]+/, "").replace(/[ \t\n\r\f\v]+$/, "");
const words = (s: string) => s.split(/[ \t\n\r\f\v]+/).filter((w) => w !== "");
const CONTROLS_RE = new RegExp("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f" + String.fromCharCode(0x2028, 0x2029, 0xfeff) + "]", "g");
const stripControls = (s: string) => s.replace(CONTROLS_RE, "");
const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DATA_RUN_RE = /data:image\/[A-Za-z0-9+;=,/%._~!$&*()#:@-]*/g;
const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

function textBytes(src: string): number {
  const total = byteLength(src);
  if (total > MAX_DATA_BYTES + Math.max(MAX_TEMPLATE_BYTES, MAX_CSS_BYTES)) return total;
  return byteLength(src.replace(DATA_RUN_RE, ""));
}

class Warn {
  private rows = new Map<string, { code: string; message: string; count: number; params: Record<string, string | number> }>();
  constructor(private where: "template" | "css") {}
  add(code: string, message: string, params: Record<string, string | number> = {}) {
    const key = `${code}\u0000${message}`;
    const row = this.rows.get(key);
    if (row) {
      row.count += 1;
      row.params = params;
    } else this.rows.set(key, { code, message, count: 1, params });
  }
  out(): SanitizeWarning[] {
    return [...this.rows.values()].map((r) => ({ where: this.where, code: r.code, message: r.message, count: r.count, params: r.params }));
  }
}

// ================================================================ HTML
const ENTITY_RE = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|amp|lt|gt|quot|apos|nbsp);/g;
const NAMED_DECODE: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", colon: ":", tab: "\t", newline: "\n", lpar: "(", rpar: ")", sol: "/", bsol: "\\",
  semi: ";", comma: ",", period: ".", num: "#", lbrace: "{", rbrace: "}", lbrack: "[", rbrack: "]",
};

/** Decode the character references a browser would decode in an attribute value (numeric ones and a few names). */
export function decodeEntities(value: string): string {
  return value.replace(/&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]{2,10}));?/g, (whole, dec?: string, hex?: string, name?: string) => {
    let code: number;
    if (dec !== undefined) code = parseInt(dec, 10);
    else if (hex !== undefined) code = parseInt(hex, 16);
    else {
      const key = lower(name ?? "");
      return Object.prototype.hasOwnProperty.call(NAMED_DECODE, key) ? NAMED_DECODE[key] : whole;
    }
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
    return String.fromCodePoint(code);
  });
}

export function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
}

function escPlain(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Text with `<`, `>` and bare `&` made harmless; the few safe character references are kept. */
export function escapeText(text: string): string {
  const out: string[] = [];
  let i = 0;
  ENTITY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENTITY_RE.exec(text))) {
    if (m.index > i) out.push(escPlain(text.slice(i, m.index)));
    const ref = m[0];
    if (ref[1] === "#") {
      const number = ref[2] === "x" || ref[2] === "X" ? parseInt(ref.slice(3, -1), 16) : parseInt(ref.slice(2, -1), 10);
      if (number === 0 || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff) || (number < 32 && number !== 9 && number !== 10 && number !== 13)) out.push(escPlain(ref));
      else out.push(ref);
    } else out.push(ref);
    i = m.index + ref.length;
  }
  out.push(escPlain(text.slice(i)));
  return out.join("");
}

type Attr = [string, string];
type HtmlToken =
  | { k: "text"; s: string }
  | { k: "start"; name: string; attrs: Attr[]; selfClosing: boolean }
  | { k: "end"; name: string }
  | { k: "dropped"; what: "comment" | "unfinished tag" | "declaration" };

const isWs = (c: string) => c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\f";

function tokeniseHtml(src: string): HtmlToken[] {
  const toks: HtmlToken[] = [];
  let i = 0;
  const n = src.length;
  const endRe = /<\/([A-Za-z][A-Za-z0-9:_-]*)/y;
  const startRe = /<([A-Za-z][A-Za-z0-9:_-]*)/y;
  const attrRe = /[^ \t\n\r\f\v"'<>/=]+/y;
  const valRe = /[^ \t\n\r\f\v>]*/y;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      toks.push({ k: "text", s: src.slice(i) });
      return toks;
    }
    if (lt > i) toks.push({ k: "text", s: src.slice(i, lt) });
    i = lt;
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      toks.push({ k: "dropped", what: "comment" });
      if (end < 0) return toks;
      i = end + 3;
      continue;
    }
    const nxt = i + 1 < n ? src[i + 1] : "";
    if (nxt === "/" && i + 2 < n && LETTERS.includes(src[i + 2])) {
      endRe.lastIndex = i;
      const m = endRe.exec(src)!;
      const end = src.indexOf(">", endRe.lastIndex);
      toks.push({ k: "end", name: lower(m[1]) });
      if (end < 0) return toks;
      i = end + 1;
      continue;
    }
    if (nxt && LETTERS.includes(nxt)) {
      startRe.lastIndex = i;
      const m = startRe.exec(src)!;
      const name = lower(m[1]);
      let j = startRe.lastIndex;
      const attrs: Attr[] = [];
      let selfClosing = false;
      let closed = false;
      while (j < n) {
        while (j < n && isWs(src[j])) j++;
        if (j >= n) break;
        if (src[j] === ">") {
          j++;
          closed = true;
          break;
        }
        if (src.startsWith("/>", j)) {
          selfClosing = true;
          closed = true;
          j += 2;
          break;
        }
        if (src[j] === "/") {
          j++;
          continue;
        }
        attrRe.lastIndex = j;
        const am = attrRe.exec(src);
        if (!am) {
          j++;
          continue;
        }
        const aname = lower(am[0]);
        j = attrRe.lastIndex;
        while (j < n && isWs(src[j])) j++;
        let value = "";
        if (j < n && src[j] === "=") {
          j++;
          while (j < n && isWs(src[j])) j++;
          if (j < n && (src[j] === '"' || src[j] === "'")) {
            const q = src[j];
            const end = src.indexOf(q, j + 1);
            if (end < 0) {
              value = src.slice(j + 1);
              j = n;
            } else {
              value = src.slice(j + 1, end);
              j = end + 1;
            }
          } else {
            valRe.lastIndex = j;
            const vm = valRe.exec(src)!;
            value = vm[0];
            j = valRe.lastIndex;
          }
        }
        attrs.push([aname, value]);
      }
      if (!closed) {
        toks.push({ k: "dropped", what: "unfinished tag" });
        return toks;
      }
      toks.push({ k: "start", name, attrs, selfClosing });
      i = j;
      continue;
    }
    if (nxt === "!" || nxt === "?") {
      const end = src.indexOf(">", i);
      toks.push({ k: "dropped", what: "declaration" });
      if (end < 0) return toks;
      i = end + 1;
      continue;
    }
    toks.push({ k: "text", s: "<" });
    i += 1;
  }
  return toks;
}

function paintOk(value: string): boolean {
  const v = strip(value);
  if (["none", "currentcolor"].includes(lower(v))) return true;
  if (HEX_COLOUR_RE.test(v) || FUNC_COLOUR_RE.test(v) || VAR_RE.test(v) || URL_REF_RE.test(v)) return true;
  return NAMED_COLOURS.has(lower(v));
}

function svgAttr(name: string, value: string): string | null {
  const kind = SVG_ATTRS[name];
  const v = strip(value);
  switch (kind) {
    case "path": return PATH_RE.test(v) ? v : null;
    case "points": return POINTS_RE.test(v) ? v : null;
    case "transform": return TRANSFORM_RE.test(v) ? v : null;
    case "viewbox": return VIEWBOX_RE.test(v) ? v : null;
    case "aspect": return ASPECT_RE.test(v) ? v : null;
    case "dash": return DASH_RE.test(v) ? v : null;
    case "length": return LENGTH_RE.test(v) ? v : null;
    case "number": return PLAIN_NUMBER_RE.test(v) ? v : null;
    case "offset": return OFFSET_RE.test(v) ? v : null;
    case "paint": return paintOk(v) ? v : null;
    case "unit": return UNIT_INTERVAL_RE.test(v) ? v : null;
    case "ref": return lower(v) === "none" || URL_REF_RE.test(v) ? v : null;
    case "id": return ID_RE.test(v) ? v : null;
    default:
      if (kind.startsWith("enum:")) return kind.slice(5).split("|").includes(v) ? v : null;
      return null;
  }
}

/** The path of an address: without the host, the query and the fragment. */
function pathOf(u: string): string {
  let p = u;
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*/.exec(p);
  if (scheme) p = p.slice(scheme[0].length);
  const cut = p.search(/[?#]/);
  return cut >= 0 ? p.slice(0, cut) : p;
}

function dataOrMedia(value: string, allowedMedia: readonly string[], counter: { n: number }): string | null {
  const v = strip(value);
  if (DATA_IMAGE_RE.test(v)) {
    if (counter.n + v.length > MAX_DATA_BYTES) return null;
    counter.n += v.length;
    return v;
  }
  const hasPath = v.includes("://") || v.startsWith("/");
  if (hasPath && !v.startsWith("//") && allowedMedia.some((a) => pathOf(v) === pathOf(a)) && MEDIA_URL_RE.test(v)) return v;
  return null;
}

type Frame = { f: "el"; tag: string; close: string } | { f: "ghost"; tag: string } | { f: "if"; hasElse: boolean };

export function sanitizeTemplate(src: unknown, allowedMedia: readonly string[] = [], warn?: Warn): SanitizeResult {
  const w = warn ?? new Warn("template");
  const res: SanitizeResult = { value: "", warnings: [], errors: [], dataBytes: 0 };
  if (typeof src !== "string") {
    res.errors.push({ where: "template", code: "type", message: "The template must be text." });
    return res;
  }
  if (textBytes(src) > MAX_TEMPLATE_BYTES) {
    res.errors.push({ where: "template", code: "too_large", message: `The template is larger than ${Math.floor(MAX_TEMPLATE_BYTES / 1024)} KB.` });
    return res;
  }
  const text = stripControls(src);
  const out: string[] = [];
  const stack: Frame[] = [];
  let skip: { tag: string; depth: number } | null = null;
  let elements = 0;
  const data = { n: 0 };
  const pending: string[] = [];
  const flush = () => {
    if (pending.length) {
      emitText(pending.join(""), out, stack, w);
      pending.length = 0;
    }
  };
  for (const token of tokeniseHtml(text)) {
    if (skip) {
      if (token.k === "start" && token.name === skip.tag && !token.selfClosing) skip = { tag: skip.tag, depth: skip.depth + 1 };
      else if (token.k === "end" && token.name === skip.tag) skip = skip.depth > 1 ? { tag: skip.tag, depth: skip.depth - 1 } : null;
      continue;
    }
    if (token.k === "dropped") {
      const [code, message] =
        token.what === "comment" ? ["comment", "Removed a comment."]
        : token.what === "unfinished tag" ? ["unfinished_tag", "Removed an unfinished tag."]
        : ["declaration", "Removed a declaration or processing instruction."];
      w.add(code, message);
      continue;
    }
    if (token.k === "text") {
      pending.push(token.s);
      continue;
    }
    if (token.k === "end") {
      let idx = -1;
      for (let k = stack.length - 1; k >= 0; k--) {
        const fr = stack[k];
        if ((fr.f === "el" || fr.f === "ghost") && fr.tag === token.name) {
          idx = k;
          break;
        }
      }
      if (idx < 0) continue;
      if (stack.slice(idx).some((fr) => fr.f !== "ghost")) flush();
      while (stack.length - 1 > idx) {
        const fr = stack.pop()!;
        if (fr.f === "if") {
          out.push("{{/if}}");
          w.add("if_closed", "Closed an if block that was still open.");
        } else if (fr.f === "el") out.push(fr.close);
      }
      const fr = stack.pop()!;
      if (fr.f === "el") out.push(fr.close);
      continue;
    }
    // start tag
    const { name, attrs, selfClosing } = token;
    if (DROP_CONTENT.has(name)) {
      w.add("dropped_element", `Removed the <${name}> element: it is not allowed.`, { tag: name });
      if (!selfClosing && !["link", "meta", "base", "input", "frame"].includes(name)) skip = { tag: name, depth: 1 };
      continue;
    }
    const isSvg = Object.prototype.hasOwnProperty.call(SVG_TAGS, name);
    if (!HTML_TAGS.has(name) && !isSvg) {
      w.add("unwrapped", `Removed the <${name}> tag but kept its text: only simple boxes and text are allowed.`, { tag: name });
      if (!selfClosing && !VOID.has(name)) stack.push({ f: "ghost", tag: name });
      continue;
    }
    elements += 1;
    if (elements > MAX_ELEMENTS) {
      res.errors.push({ where: "template", code: "too_many", message: `More than ${MAX_ELEMENTS} elements.` });
      return res;
    }
    if (stack.filter((fr) => fr.f === "el").length >= MAX_DEPTH) {
      w.add("too_deep", `Removed a box nested more than ${MAX_DEPTH} levels deep.`, { max: MAX_DEPTH });
      if (!selfClosing && !VOID.has(name)) stack.push({ f: "ghost", tag: name });
      continue;
    }
    const canon = isSvg ? SVG_TAGS[name] : name;
    const allowed = isSvg ? SVG_ELEMENT_ATTRS[name] : null;
    const built: string[] = [];
    const seen = new Set<string>();
    for (const [aname, avalue] of attrs) {
      const value = stripControls(decodeEntities(avalue));
      if (seen.has(aname)) continue;
      seen.add(aname);
      if (aname === "class") {
        const names: string[] = [];
        for (const c of words(value)) {
          if (!CLASS_RE.test(c)) w.add("class", "Removed a class name with odd characters.");
          else if (RESERVED_CLASSES.has(lower(c))) w.add("reserved_class", `Removed the class "${c}": the card engine uses it.`, { name: c });
          else names.push(c);
        }
        if (names.length) built.push(` class="${escapeAttr(names.join(" "))}"`);
        continue;
      }
      if (aname.startsWith("on")) {
        w.add("event_attr", `Removed the ${aname} attribute: scripts are not allowed.`, { name: aname });
        continue;
      }
      if (aname === "style") {
        w.add("style_attr", "Removed a style attribute: use classes and the CSS box instead.");
        continue;
      }
      if (name === "img") {
        if (aname === "src") {
          const cleaned = dataOrMedia(value, allowedMedia, data);
          if (cleaned === null) w.add("img_src", "Removed an image address: only pictures embedded as data:image or your own uploaded files are allowed.");
          else built.push(` src="${escapeAttr(cleaned)}"`);
          continue;
        }
        if (aname === "alt") {
          built.push(` alt="${escapeAttr(value.slice(0, 120))}"`);
          continue;
        }
        if ((aname === "width" || aname === "height") && LENGTH_RE.test(strip(value))) {
          built.push(` ${aname}="${escapeAttr(strip(value))}"`);
          continue;
        }
      }
      if (isSvg && allowed!.has(aname)) {
        const cleaned = svgAttr(aname, value);
        if (cleaned === null) w.add("svg_attr", `Removed the ${aname} value on <${canon}>: it is not an allowed value.`, { name: aname, tag: canon });
        else built.push(` ${ATTR_CASE[aname] ?? aname}="${escapeAttr(cleaned)}"`);
        continue;
      }
      w.add("attr", `Removed the ${aname} attribute on <${canon}>.`, { name: aname, tag: canon });
    }
    if (name === "img" && !built.join("").includes(" src=")) {
      w.add("img_no_src", "Removed an image without a usable address.");
      continue;
    }
    flush();
    const open = `<${canon}${built.join("")}`;
    if (VOID.has(name)) out.push(open + ">");
    else if (SVG_LEAVES.has(name)) out.push(open + "/>");
    else {
      out.push(open + ">");
      stack.push({ f: "el", tag: name, close: `</${canon}>` });
    }
  }
  flush();
  while (stack.length) {
    const fr = stack.pop()!;
    if (fr.f === "if") {
      out.push("{{/if}}");
      w.add("if_closed", "Closed an if block that was still open.");
    } else if (fr.f === "el") out.push(fr.close);
  }
  res.value = out.join("");
  res.warnings = w.out();
  res.dataBytes = data.n;
  return res;
}

function emitText(text: string, out: string[], stack: Frame[], w: Warn) {
  const re = /\{\{([^{}]{0,40})\}\}/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > pos) out.push(escapeText(text.slice(pos, m.index)));
    pos = m.index + m[0].length;
    const inner = words(m[1]).join(" ");
    if (PLACEHOLDERS.includes(inner)) out.push("{{" + inner + "}}");
    else if (inner.startsWith("#if ")) {
      const cond = strip(inner.slice(4));
      if (CONDITIONS.includes(cond)) {
        stack.push({ f: "if", hasElse: false });
        out.push("{{#if " + cond + "}}");
      } else w.add("if_unknown", `Removed the placeholder "${inner}": no such value to test.`, { text: inner });
    } else if (inner === "else") {
      const top = stack[stack.length - 1];
      if (top && top.f === "if" && !top.hasElse) {
        stack[stack.length - 1] = { f: "if", hasElse: true };
        out.push("{{else}}");
      } else w.add("else_stray", "Removed an else that has no if block directly around it.");
    } else if (inner === "/if") {
      const top = stack[stack.length - 1];
      if (top && top.f === "if") {
        stack.pop();
        out.push("{{/if}}");
      } else w.add("endif_stray", "Removed an end-if that has no if block in the same box.");
    } else w.add("placeholder", `Removed the placeholder "${inner}": it is not one of the values a face can show.`, { text: inner });
  }
  out.push(escapeText(text.slice(pos)));
}

// ================================================================ CSS
interface Tok {
  t: string; // ws ident func atkw hash string num dim perc url delim { } ( ) [ ] ; : , bad raw
  v: string;
  n: number;
  u: string;
}
const tok = (t: string, v = "", n = 0, u = ""): Tok => ({ t, v, n, u });

const HEX = "0123456789abcdefABCDEF";
const isIdentStart = (c: string) => (c.length > 0 && /[A-Za-z]/.test(c)) || c === "_" || c.charCodeAt(0) > 127;
const isIdentChar = (c: string) => isIdentStart(c) || /[0-9]/.test(c) || c === "-";
const FFFD = "�";

function readEscape(s: string, i: number): [string, number] {
  if (i >= s.length) return [FFFD, i];
  const c = s[i];
  if (HEX.includes(c)) {
    let j = i;
    while (j < s.length && j - i < 6 && HEX.includes(s[j])) j++;
    let code = parseInt(s.slice(i, j), 16);
    if (j < s.length && isWs(s[j])) j++;
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) code = 0xfffd;
    return [String.fromCodePoint(code), j];
  }
  return [c, i + 1];
}

function readName(s: string, i: number): [string, number] {
  const out: string[] = [];
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (isIdentChar(c)) {
      out.push(c);
      i++;
    } else if (c === "\\" && i + 1 < n && s[i + 1] !== "\n") {
      const [ch, next] = readEscape(s, i + 1);
      out.push(ch);
      i = next;
    } else break;
  }
  return [out.join(""), i];
}

function startsIdent(s: string, i: number): boolean {
  const n = s.length;
  if (i >= n) return false;
  const c = s[i];
  if (c === "-") return i + 1 < n && (isIdentStart(s[i + 1]) || s[i + 1] === "-" || (s[i + 1] === "\\" && i + 2 < n && s[i + 2] !== "\n"));
  if (isIdentStart(c)) return true;
  return c === "\\" && i + 1 < n && s[i + 1] !== "\n";
}

const NUM_RE = /[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/y;

function tokeniseCss(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (isWs(c)) {
      while (i < n && isWs(s[i])) i++;
      toks.push(tok("ws"));
      continue;
    }
    if (c === "/" && s.startsWith("/*", i)) {
      const end = s.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      const buf: string[] = [];
      let bad = false;
      while (i < n) {
        const d = s[i];
        if (d === q) {
          i++;
          break;
        }
        if (d === "\n") {
          bad = true;
          break;
        }
        if (d === "\\") {
          if (i + 1 < n && s[i + 1] === "\n") {
            i += 2;
            continue;
          }
          if (i + 1 >= n) {
            i++;
            continue;
          }
          const [ch, next] = readEscape(s, i + 1);
          buf.push(ch);
          i = next;
          continue;
        }
        buf.push(d);
        i++;
      }
      toks.push(tok(bad ? "bad" : "string", buf.join("")));
      continue;
    }
    if (c === "#") {
      if (i + 1 < n && (isIdentChar(s[i + 1]) || s[i + 1] === "\\")) {
        const [name, next] = readName(s, i + 1);
        i = next;
        toks.push(tok("hash", name));
      } else {
        toks.push(tok("delim", "#"));
        i++;
      }
      continue;
    }
    if ("0123456789+-.".includes(c)) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(s);
      if (m) {
        i = NUM_RE.lastIndex;
        const value = parseFloat(m[0]);
        if (!(value > -1e9 && value < 1e9)) {
          toks.push(tok("bad", m[0].slice(0, 20)));
          continue;
        }
        if (i < n && s[i] === "%") {
          toks.push(tok("perc", m[0], value));
          i++;
        } else if (startsIdent(s, i)) {
          const [unit, next] = readName(s, i);
          i = next;
          toks.push(tok("dim", m[0], value, lower(unit)));
        } else toks.push(tok("num", m[0], value));
        continue;
      }
    }
    if (startsIdent(s, i)) {
      const [name, next] = readName(s, i);
      i = next;
      if (i < n && s[i] === "(") {
        i++;
        if (lower(name) === "url") {
          let j = i;
          while (j < n && isWs(s[j])) j++;
          if (j < n && (s[j] === '"' || s[j] === "'")) {
            toks.push(tok("func", "url"));
            i = j;
            continue;
          }
          const buf: string[] = [];
          let bad = false;
          while (j < n) {
            const d = s[j];
            if (d === ")") {
              j++;
              break;
            }
            if (d === '"' || d === "'" || d === "(" || isWs(d) || d.charCodeAt(0) < 32) {
              bad = true;
              while (j < n && s[j] !== ")") j++;
              j++;
              break;
            }
            if (d === "\\") {
              const [ch, nx] = readEscape(s, j + 1);
              buf.push(ch);
              j = nx;
              continue;
            }
            buf.push(d);
            j++;
          }
          toks.push(tok(bad ? "bad" : "url", buf.join("")));
          i = j;
          continue;
        }
        toks.push(tok("func", lower(name)));
        continue;
      }
      toks.push(tok("ident", name));
      continue;
    }
    if (c === "@") {
      if (startsIdent(s, i + 1)) {
        const [name, next] = readName(s, i + 1);
        i = next;
        toks.push(tok("atkw", lower(name)));
      } else {
        toks.push(tok("delim", "@"));
        i++;
      }
      continue;
    }
    if ("{}()[];:,".includes(c)) {
      toks.push(tok(c));
      i++;
      continue;
    }
    if (c === "\\") {
      toks.push(tok("bad", "\\"));
      i++;
      continue;
    }
    toks.push(tok("delim", c));
    i++;
  }
  return toks;
}

// ---- property table. Letters: L length  N number  C colour  A angle  T time  F fr  G gradients  U url  S string
//      X transform functions  E filter functions  P shape functions  B timing functions  R grid functions
//      M comma lists  D slash  K:keywords
const GLOBAL_KW = new Set(["inherit", "initial", "unset"]);
const BORDER_STYLE = "none solid dashed dotted double hidden";
export const PROPS: Record<string, string> = {};
function def(names: string, spec: string) {
  for (const name of names.split(" ")) if (name) PROPS[name] = spec;
}
def("display", "K:block flex grid inline inline-block inline-flex inline-grid none contents");
def("position", "K:static relative absolute");
def("top right bottom left inset width height min-width min-height max-width max-height", "L K:auto none fit-content min-content max-content");
def("margin margin-top margin-right margin-bottom margin-left", "L K:auto");
def("padding padding-top padding-right padding-bottom padding-left", "L");
def("z-index", "N K:auto");
def("flex", "N L K:auto none");
def("flex-grow flex-shrink order", "N");
def("flex-basis", "L K:auto content");
def("flex-direction", "K:row row-reverse column column-reverse");
def("flex-wrap", "K:nowrap wrap wrap-reverse");
def("flex-flow", "K:row row-reverse column column-reverse nowrap wrap wrap-reverse");
def("justify-content align-content", "K:flex-start flex-end center space-between space-around space-evenly start end stretch normal");
def("align-items align-self justify-items justify-self place-items place-content place-self", "K:flex-start flex-end center baseline stretch start end normal auto space-between space-around space-evenly");
def("gap row-gap column-gap grid-gap", "L");
def("grid-template-columns grid-template-rows grid-auto-columns grid-auto-rows", "L F R K:auto none min-content max-content");
def("grid-column grid-row grid-column-start grid-column-end grid-row-start grid-row-end", "N D K:auto span");
def("grid-auto-flow", "K:row column dense");
def("overflow overflow-x overflow-y", "K:visible hidden clip");
def("object-fit", "K:fill contain cover none scale-down");
def("object-position transform-origin background-position", "L K:left right top bottom center");
def("aspect-ratio", "N D K:auto");
def("box-sizing", "K:border-box content-box");
def("color background-color border-color border-top-color border-right-color border-bottom-color border-left-color text-decoration-color caret-color fill stroke", "C");
def("opacity", "N");
def("font-size letter-spacing word-spacing text-indent", "L K:normal");
def("font-weight", "N K:normal bold bolder lighter");
def("font-style", "K:normal italic oblique");
def("font-variant-numeric font-variant", "K:normal tabular-nums lining-nums oldstyle-nums small-caps proportional-nums");
def("line-height", "N L K:normal");
def("text-align", "K:left right center justify start end");
def("text-transform", "K:none uppercase lowercase capitalize");
def("text-decoration text-decoration-line", "C K:none underline line-through solid");
def("text-overflow", "K:clip ellipsis");
def("white-space", "K:normal nowrap pre pre-wrap pre-line");
def("word-break", "K:normal break-all keep-all break-word");
def("overflow-wrap word-wrap", "K:normal break-word anywhere");
def("vertical-align", "L K:baseline top middle bottom text-top text-bottom sub super");
def("direction", "K:ltr rtl");
def("unicode-bidi", "K:normal embed isolate bidi-override isolate-override plaintext");
def("text-shadow box-shadow", "L C M K:none inset");
def("-webkit-line-clamp line-clamp", "N K:none");
def("background", "L C G U M D K:none no-repeat repeat repeat-x repeat-y space round cover contain left right top center bottom border-box padding-box content-box");
def("background-image", "G U M K:none");
def("background-size", "L M K:auto cover contain");
def("background-repeat", "M K:repeat repeat-x repeat-y no-repeat space round");
def("background-clip background-origin", "K:border-box padding-box content-box text");
def("background-blend-mode mix-blend-mode", "K:normal multiply screen overlay darken lighten color-dodge color-burn soft-light hard-light difference exclusion");
def("border", "L C K:" + BORDER_STYLE + " thin medium thick");
def("border-top border-right border-bottom border-left", "L C K:" + BORDER_STYLE + " thin medium thick");
def("border-width border-top-width border-right-width border-bottom-width border-left-width", "L K:thin medium thick");
def("border-style border-top-style border-right-style border-bottom-style border-left-style", "K:" + BORDER_STYLE);
def("border-radius border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius border-start-start-radius border-start-end-radius border-end-start-radius border-end-end-radius", "L D");
def("transform", "X L N A K:none");
def("translate rotate scale", "L N A K:none");
def("clip-path", "P L K:none at closest-side farthest-side nonzero evenodd round");
def("filter backdrop-filter", "E L N A K:none");
def("pointer-events", "K:none");
def("content", "S K:none normal");
def("font-family", "S M K:serif sans-serif monospace cursive system-ui");
def("animation", "N T B K:none normal reverse alternate alternate-reverse forwards backwards both running paused ease ease-in ease-out ease-in-out linear step-start step-end");
def("animation-name", "M K:none");
def("animation-duration animation-delay", "T M");
def("animation-iteration-count", "N M");
def("animation-timing-function", "B M K:ease ease-in ease-out ease-in-out linear step-start step-end");
def("animation-fill-mode", "M K:none forwards backwards both");
def("animation-direction", "M K:normal reverse alternate alternate-reverse");
def("animation-play-state", "K:running paused");
def("will-change", "K:auto transform opacity");
def("visibility", "K:visible hidden");
def("isolation", "K:auto isolate");
def("writing-mode", "K:horizontal-tb vertical-rl vertical-lr");

const CARD_FONT_FAMILIES = new Set([
  "anton", "bebas neue", "cairo", "caveat", "cormorant garamond", "dm sans", "dm serif display", "dancing script", "fraunces", "jetbrains mono", "lora",
  "manrope", "montserrat", "nunito", "oswald", "outfit", "playfair display", "plus jakarta sans", "poppins", "press start 2p", "sora", "space grotesk",
  "space mono", "syne", "tajawal", "ibm plex sans arabic", "inter", "arial", "helvetica", "georgia", "times new roman", "courier new",
]);
const COLOUR_FUNCS = new Set(["rgb", "rgba", "hsl", "hsla"]);
const GRADIENT_FUNCS = new Set(["linear-gradient", "radial-gradient", "conic-gradient", "repeating-linear-gradient", "repeating-radial-gradient", "repeating-conic-gradient"]);
const MATH_FUNCS = new Set(["calc", "min", "max", "clamp"]);
const TRANSFORM_FUNCS = new Set(["translate", "translatex", "translatey", "scale", "scalex", "scaley", "rotate", "skew", "skewx", "skewy"]);
const FILTER_FUNCS = new Set(["blur", "brightness", "contrast", "grayscale", "saturate", "hue-rotate", "drop-shadow", "opacity", "sepia", "invert"]);
const SHAPE_FUNCS = new Set(["polygon", "circle", "ellipse", "inset"]);
const TIMING_FUNCS = new Set(["cubic-bezier", "steps"]);
const GRID_FUNCS = new Set(["repeat", "minmax", "fit-content"]);
const EXTRA_KEYWORDS = new Set([
  "to", "top", "bottom", "left", "right", "center", "at", "closest-side", "farthest-side", "closest-corner", "farthest-corner", "in", "circle", "ellipse",
  "from", "auto", "span", "auto-fill", "auto-fit", "min-content", "max-content", "round", "evenodd", "nonzero",
]);
const GRADIENT_KW = ["to", "top", "bottom", "left", "right", "center", "at", "closest-side", "farthest-side", "closest-corner", "farthest-corner", "in", "circle", "ellipse", "from"];
const SIZE_UNITS = new Set(["cqw", "em"]);
const ANGLE_UNITS = new Set(["deg", "turn", "rad", "grad"]);
const TIME_UNITS = new Set(["s", "ms"]);
const FONT_WEIGHT_MAX = 1000;
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const IDENT_RE = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;

function num(x: number): string {
  if (x === Math.trunc(x)) return String(Math.trunc(x));
  const text = x.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" || text === "" ? "0" : text;
}

function split(spec: string): { flags: Set<string>; kw: Set<string> } {
  const at = spec.indexOf("K:");
  const letters = at >= 0 ? spec.slice(0, at) : spec;
  const kws = at >= 0 ? spec.slice(at + 2) : "";
  return { flags: new Set(letters.replace(/ /g, "")), kw: new Set(kws.split(" ").filter(Boolean)) };
}

function grabArgs(toks: Tok[], i: number): [number, Tok[] | null] {
  let depth = 1;
  let j = i;
  const n = toks.length;
  while (j < n) {
    const t = toks[j].t;
    if (t === "(" || t === "func") depth++;
    else if (t === ")") {
      depth--;
      if (depth === 0) return [j + 1, toks.slice(i, j)];
    } else if (t === "{" || t === "}") return [i, null];
    j++;
  }
  return [i, null];
}

function skipBlock(toks: Tok[], i: number): number {
  let depth = 0;
  let j = i;
  const n = toks.length;
  while (j < n) {
    if (toks[j].t === "{") depth++;
    else if (toks[j].t === "}") {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return n;
}

function nthPiece(t: Tok): string {
  if (t.t === "num") return num(t.n);
  if (t.t === "dim" && t.u === "n") return num(t.n) + "n";
  if (t.t === "ident") return lower(t.v);
  if (t.t === "delim" && (t.v === "+" || t.v === "-")) return t.v;
  return "\u0000";
}

function blockOf(toks: Tok[], j: number, end: number): Tok[] {
  return end - 1 > j && toks[end - 1].t === "}" ? toks.slice(j + 1, end - 1) : toks.slice(j + 1, end);
}

class Css {
  prefix: string;
  keyframePrefix: string;
  keyframesSeen = new Set<string>();
  rules = 0;
  data: { n: number };

  constructor(private faceId: number, private allowedMedia: readonly string[], private w: Warn, dataStart: number) {
    this.prefix = `.cfl .face.cf-${faceId}`;
    this.keyframePrefix = `cf${faceId}-`;
    this.data = { n: dataStart };
  }

  // ---- values
  animationValue(prop: string, toks: Tok[]): string | null {
    const { flags, kw } = split(PROPS[prop]);
    for (const g of GLOBAL_KW) kw.add(g);
    return this.animation(prop, toks, flags, kw);
  }

  seq(toks: Tok[], flags: Set<string>, kw: Set<string>, prop: string, depth: number, inCalc = false): string[] | null {
    const out: string[] = [];
    for (const tk of toks) {
      const t = tk.t;
      if (t === "ws") {
        if (out.length && out[out.length - 1] !== " ") out.push(" ");
        continue;
      }
      if (t === "ident") {
        const name = tk.v;
        const low = lower(name);
        if (!IDENT_RE.test(name)) return null;
        if (prop === "font-family") return null;
        if (kw.has(low) || GLOBAL_KW.has(low) || (EXTRA_KEYWORDS.has(low) && (flags.has("G") || flags.has("P") || flags.has("R") || flags.has("X")))) out.push(low);
        else if (flags.has("C") && NAMED_COLOURS.has(low)) out.push(low);
        else if (inCalc && (low === "e" || low === "pi")) out.push(low);
        else return null;
        continue;
      }
      if (t === "num") {
        if (flags.has("N") || tk.n === 0 || inCalc) out.push(num(tk.n));
        else return null;
        continue;
      }
      if (t === "perc") {
        if (flags.has("L") || inCalc || flags.has("G") || flags.has("P") || flags.has("E") || flags.has("R") || flags.has("X") || flags.has("C")) out.push(num(tk.n) + "%");
        else return null;
        continue;
      }
      if (t === "dim") {
        const unit = tk.u;
        const ok =
          (SIZE_UNITS.has(unit) && (flags.has("L") || inCalc || flags.has("G") || flags.has("P") || flags.has("E") || flags.has("R") || flags.has("X"))) ||
          (ANGLE_UNITS.has(unit) && (flags.has("A") || flags.has("G") || flags.has("X") || flags.has("E"))) ||
          (TIME_UNITS.has(unit) && flags.has("T")) ||
          (unit === "fr" && flags.has("F"));
        if (!ok) return null;
        out.push(num(tk.n) + unit);
        continue;
      }
      if (t === "hash") {
        if ((flags.has("C") || flags.has("G")) && HEX_COLOUR_RE.test("#" + tk.v)) {
          out.push("#" + lower(tk.v));
          continue;
        }
        return null;
      }
      if (t === "string") {
        if (!flags.has("S") || tk.v.length > 80 || /[\x00-\x1f\x7f]/.test(tk.v)) return null;
        if (prop === "font-family" && !CARD_FONT_FAMILIES.has(lower(strip(tk.v)))) return null;
        out.push('"' + tk.v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');
        continue;
      }
      if (t === ",") {
        if (flags.has("M") || depth > 0) {
          out.push(",");
          continue;
        }
        return null;
      }
      if (t === "delim") {
        if (tk.v === "/" && (flags.has("D") || depth > 0 || inCalc)) {
          out.push("/");
          continue;
        }
        if ((tk.v === "+" || tk.v === "-" || tk.v === "*") && inCalc) {
          out.push(" " + tk.v + " ");
          continue;
        }
        return null;
      }
      if (t === "url") {
        if (!flags.has("U")) return null;
        const u = this.url(tk.v);
        if (u === null) return null;
        out.push(u);
        continue;
      }
      return null;
    }
    return out;
  }

  animation(prop: string, toks: Tok[], _flags: Set<string>, kw: Set<string>): string | null {
    const items = toks.filter((tk) => tk.t !== "ws");
    let depth = 0;
    for (const tk of items) {
      if (tk.t === "func" || tk.t === "(") depth++;
      else if (tk.t === ")") depth--;
      else if (tk.t === "," && depth === 0 && prop !== "animation-name") return null;
    }
    if (prop === "animation-iteration-count") {
      const ok = items.filter((tk) => tk.t !== ",").every((tk) => tk.t === "num" && tk.n >= 0 && tk.n <= 3);
      return ok && items.length ? items.map((tk) => num(tk.n)).join(" ") : null;
    }
    if (prop === "animation-duration" || prop === "animation-delay") {
      if (items.length !== 1 || items[0].t !== "dim" || !TIME_UNITS.has(items[0].u)) return null;
      const seconds = items[0].n / (items[0].u === "ms" ? 1000 : 1);
      if (seconds < 0 || seconds > (prop === "animation-duration" ? MAX_ANIMATION_SECONDS : 2)) return null;
      return num(items[0].n) + items[0].u;
    }
    if (prop === "animation-name") {
      const names: string[] = [];
      for (const tk of items) {
        if (tk.t === ",") continue;
        if (tk.t !== "ident" || !(tk.v === "none" || tk.v.startsWith(this.keyframePrefix)) || !NAME_RE.test(tk.v)) return null;
        names.push(tk.v);
      }
      return names.length ? names.join(",") : null;
    }
    const flat: string[] = [];
    let i = 0;
    let duration: number | null = null;
    let delay: number | null = null;
    let count = 1;
    while (i < items.length) {
      const tk = items[i];
      if (tk.t === "dim" && TIME_UNITS.has(tk.u)) {
        const seconds = tk.n / (tk.u === "ms" ? 1000 : 1);
        if (duration === null) duration = seconds;
        else if (delay === null) delay = seconds;
        else return null;
        flat.push(num(tk.n) + tk.u);
      } else if (tk.t === "num") {
        if (!(tk.n >= 0 && tk.n <= 3)) return null;
        count = tk.n;
        flat.push(num(tk.n));
      } else if (tk.t === "ident") {
        const low = lower(tk.v);
        if (low === "infinite") return null;
        if (kw.has(low) || GLOBAL_KW.has(low)) flat.push(low);
        else if (tk.v.startsWith(this.keyframePrefix) && NAME_RE.test(tk.v)) flat.push(tk.v);
        else return null;
      } else if (tk.t === "func" && TIMING_FUNCS.has(tk.v)) {
        const [j, inner] = grabArgs(items, i + 1);
        if (inner === null) return null;
        const parts = this.seq(inner, new Set(["N"]), new Set(), prop, 1);
        if (parts === null) return null;
        flat.push(`${tk.v}(${parts.join("")})`);
        i = j;
        continue;
      } else return null;
      i++;
    }
    if (prop === "animation" && (duration === null || duration > MAX_ANIMATION_SECONDS || (delay ?? 0) > 2 || duration * Math.max(count, 1) > MAX_ANIMATION_SECONDS)) return null;
    return flat.length ? flat.join(" ") : null;
  }

  url(raw: string): string | null {
    const v = strip(raw);
    if (v.length > MAX_DATA_BYTES) return null;
    if (DATA_IMAGE_RE.test(v) || DATA_SVG_RE.test(v)) {
      if (this.data.n + v.length > MAX_DATA_BYTES) return null;
      this.data.n += v.length;
      return 'url("' + v.replace(/"/g, "%22") + '")';
    }
    if (v.startsWith("//") || !MEDIA_URL_RE.test(v)) return null;
    const path = pathOf(v);
    if (this.allowedMedia.some((a) => path === pathOf(a))) return 'url("' + v + '")';
    return null;
  }

  // ---- grouping: turn function tokens into one nested serialised piece
  simplify(prop: string, toks: Tok[], depth = 0): Tok[] | null {
    const { flags } = split(PROPS[prop]);
    const out: Tok[] = [];
    let i = 0;
    while (i < toks.length) {
      const tk = toks[i];
      if (tk.t === "func") {
        const [j, inner] = grabArgs(toks, i + 1);
        if (inner === null || depth > 5) return null;
        const text = this.func(prop, tk.v, inner, flags, depth);
        if (text === null) return null;
        out.push(tok("raw", text));
        i = j;
        continue;
      }
      if (["(", ")", "[", "]", "{", "}", ";", ":", "bad", "atkw"].includes(tk.t)) return null;
      out.push(tk);
      i++;
    }
    return out;
  }

  func(prop: string, name: string, inner: Tok[], flags: Set<string>, depth: number): string | null {
    const low = lower(name);
    if (low === "url") {
      const items = inner.filter((t) => t.t !== "ws");
      if (flags.has("U") && items.length === 1 && items[0].t === "string") return this.url(items[0].v);
      return null;
    }
    if (COLOUR_FUNCS.has(low)) {
      if (!flags.has("C") && !flags.has("G") && !flags.has("E")) return null;
      const body = this.simplifyArgs(prop, inner, new Set(["N", "L", "A"]), depth, false, new Set(["none"]));
      return body === null ? null : `${low}(${body})`;
    }
    if (MATH_FUNCS.has(low)) {
      if (!["L", "N", "A", "T"].some((f) => flags.has(f))) return null;
      const body = this.simplifyArgs(prop, inner, new Set([...flags, "L", "N"]), depth, true);
      return body === null ? null : `${low}(${body})`;
    }
    if (low === "var") {
      const items = inner.filter((t) => t.t !== "ws");
      if (items.length === 1 && items[0].t === "ident" && VAR_RE.test(`var(${items[0].v})`)) {
        if (prop === "font-family" || flags.has("C") || flags.has("L") || flags.has("G") || flags.has("S")) return `var(${items[0].v})`;
      }
      return null;
    }
    if (GRADIENT_FUNCS.has(low)) {
      if (!flags.has("G")) return null;
      const body = this.simplifyArgs(prop, inner, new Set(["C", "L", "A", "N", "G"]), depth);
      return body === null ? null : `${low}(${body})`;
    }
    if (TRANSFORM_FUNCS.has(low)) {
      if (!flags.has("X")) return null;
      const body = this.simplifyArgs(prop, inner, new Set(["L", "N", "A"]), depth);
      return body === null ? null : `${low}(${body})`;
    }
    if (FILTER_FUNCS.has(low)) {
      if (!flags.has("E")) return null;
      const body = this.simplifyArgs(prop, inner, new Set(["L", "N", "A", "C"]), depth);
      if (body === null) return null;
      if (low === "blur") {
        const m = /^(-?[0-9.]+)(?:cqw|em)?$/.exec(body);
        if (!m || parseFloat(m[1]) > 6) return null;
      }
      return `${low}(${body})`;
    }
    if (SHAPE_FUNCS.has(low)) {
      if (!flags.has("P")) return null;
      const body = this.simplifyArgs(prop, inner, new Set(["L", "N", "P"]), depth, false, EXTRA_KEYWORDS);
      return body === null ? null : `${low}(${body})`;
    }
    if (TIMING_FUNCS.has(low)) return null;
    if (GRID_FUNCS.has(low)) {
      if (!flags.has("R")) return null;
      const body = this.simplifyArgs(prop, inner, new Set(["L", "F", "N", "R"]), depth, false, EXTRA_KEYWORDS);
      return body === null ? null : `${low}(${body})`;
    }
    return null;
  }

  simplifyArgs(prop: string, inner: Tok[], flags: Set<string>, depth: number, inCalc = false, extraKw: Iterable<string> = []): string | null {
    const toks = this.simplify(prop, inner, depth + 1);
    if (toks === null) return null;
    const kw = new Set(extraKw);
    if (flags.has("G") || flags.has("C")) for (const k of GRADIENT_KW) kw.add(k);
    const parts = this.seqRaw(toks, flags, kw, prop, depth + 1, inCalc);
    return parts === null ? null : parts.join("").replace(/[ \t\n\r\f]+/g, " ").replace(/^ +| +$/g, "");
  }

  seqRaw(toks: Tok[], flags: Set<string>, kw: Set<string>, prop: string, depth: number, inCalc: boolean): string[] | null {
    const out: string[] = [];
    for (const tk of toks) {
      if (tk.t === "raw") {
        out.push(tk.v);
        continue;
      }
      if (tk.t === "ws") {
        out.push(" ");
        continue;
      }
      const f = new Set(flags);
      if (flags.has("G")) f.add("C");
      const piece = this.seq([tk], f, kw, prop, depth, inCalc);
      if (piece === null) return null;
      out.push(...piece);
    }
    return out;
  }

  // ---- declarations
  declarations(toks: Tok[]): string[] {
    const out: string[] = [];
    let i = 0;
    const n = toks.length;
    while (i < n) {
      while (i < n && (toks[i].t === "ws" || toks[i].t === ";")) i++;
      if (i >= n) break;
      let j = i;
      let depth = 0;
      let nested = false;
      while (j < n) {
        const t = toks[j].t;
        if (t === "(" || t === "[" || t === "func") depth++;
        else if (t === ")" || t === "]") depth = Math.max(0, depth - 1);
        else if (t === "{") {
          nested = true;
          break;
        } else if (t === ";" && depth === 0) break;
        j++;
      }
      if (nested) {
        this.w.add("nested_rule", "Removed a nested rule inside a declaration block: nesting is not allowed.");
        i = skipBlock(toks, j);
        continue;
      }
      const decl = toks.slice(i, j);
      i = j + 1;
      const cleaned = this.declaration(decl);
      if (cleaned) out.push(cleaned);
    }
    return out;
  }

  declaration(decl: Tok[]): string | null {
    const items = [...decl];
    while (items.length && items[0].t === "ws") items.shift();
    if (items.length < 3 || items[0].t !== "ident") {
      this.w.add("bad_declaration", "Removed a declaration that could not be read.");
      return null;
    }
    const name = lower(items[0].v);
    let k = 1;
    while (k < items.length && items[k].t === "ws") k++;
    if (k >= items.length || items[k].t !== ":") {
      this.w.add("bad_declaration", "Removed a declaration that could not be read.");
      return null;
    }
    let value = items.slice(k + 1);
    const stripped = value.filter((t) => t.t !== "ws");
    if (stripped.length >= 2) {
      const last = stripped[stripped.length - 1];
      const before = stripped[stripped.length - 2];
      if (last.t === "ident" && lower(last.v) === "important" && before.t === "delim" && before.v === "!") {
        let idx = -1;
        value.forEach((t, m) => {
          if (t.t === "delim" && t.v === "!") idx = m;
        });
        value = value.slice(0, idx);
        this.w.add("important", "Removed !important: it is not needed and not allowed.");
      }
    }
    if (name.startsWith("--")) {
      this.w.add("custom_property", `Removed the custom property ${name}: only the face colours may be used with var().`, { name });
      return null;
    }
    if (!Object.prototype.hasOwnProperty.call(PROPS, name)) {
      this.w.add("property", `Removed the property "${name}": it is not on the list of allowed properties.`, { name });
      return null;
    }
    if (value.some((t) => t.t === "bad")) {
      this.w.add("bad_value", `Removed ${name}: the value could not be read.`, { name });
      return null;
    }
    let text: string | null;
    if (name.startsWith("animation")) text = this.animationValue(name, value);
    else {
      const simple = this.simplify(name, value);
      text = simple === null ? null : this.finish(name, simple);
    }
    if (text === null) {
      this.w.add("value", `Removed ${name}: the value is not allowed (check units, colours and functions).`, { name });
      return null;
    }
    return `${name}:${text}`;
  }

  finish(prop: string, simple: Tok[]): string | null {
    const { flags, kw } = split(PROPS[prop]);
    for (const g of GLOBAL_KW) kw.add(g);
    if (prop === "font-family") {
      const parts: string[] = [];
      for (const tk of simple) {
        if (tk.t === "ws") continue;
        if (tk.t === "raw") parts.push(tk.v);
        else if (tk.t === ",") parts.push(",");
        else if (tk.t === "string") {
          if (!CARD_FONT_FAMILIES.has(lower(strip(tk.v)))) return null;
          parts.push('"' + tk.v.replace(/\\/g, "").replace(/"/g, "") + '"');
        } else if (tk.t === "ident" && kw.has(lower(tk.v))) parts.push(lower(tk.v));
        else return null;
      }
      return parts.join("") || null;
    }
    const parts = this.seqRaw(simple, flags, kw, prop, 0, false);
    if (parts === null) return null;
    const text = parts.join("").replace(/[ \t\n\r\f]+/g, " ").replace(/^ +| +$/g, "");
    if (!text) return null;
    if (prop === "z-index" && /^-?[0-9]+$/.test(text)) {
      const z = parseInt(text, 10);
      if (!(z >= -2 && z <= 20)) return null;
    }
    if (prop === "font-weight" && /^[0-9]+(?:\.[0-9]+)?$/.test(text) && !(parseFloat(text) >= 1 && parseFloat(text) <= FONT_WEIGHT_MAX)) return null;
    if (prop === "opacity" && /^-?[0-9]*\.?[0-9]+$/.test(text) && !(parseFloat(text) >= 0 && parseFloat(text) <= 1)) return null;
    if (prop === "content" && text.includes("(")) return null;
    return text;
  }

  // ---- selectors
  selectorList(toks: Tok[]): string[] {
    const groups: Tok[][] = [[]];
    let depth = 0;
    for (const t of toks) {
      if (t.t === "(" || t.t === "func") depth++;
      else if (t.t === ")") depth = Math.max(0, depth - 1);
      if (t.t === "," && depth === 0) groups.push([]);
      else groups[groups.length - 1].push(t);
    }
    const out: string[] = [];
    for (const g of groups) {
      const s = this.selector(g);
      if (s === null) this.w.add("selector", "Removed a selector that is not allowed (only classes, simple tags and a few pseudo-classes).");
      else out.push(s);
    }
    return out;
  }

  unscope(items: Tok[]): Tok[] {
    const want: [string, string][] = [["delim", "."], ["ident", "cfl"], ["ws", ""], ["delim", "."], ["ident", "face"], ["delim", "."], ["ident", `cf-${this.faceId}`]];
    if (items.length >= want.length && want.every(([k, v], idx) => items[idx].t === k && (!v || items[idx].v === v))) {
      return [tok(":"), tok("ident", "scope"), ...items.slice(want.length)];
    }
    return items;
  }

  selector(toks: Tok[]): string | null {
    const items = this.unscope([...toks]);
    while (items.length && items[0].t === "ws") items.shift();
    while (items.length && items[items.length - 1].t === "ws") items.pop();
    if (!items.length) return null;
    const parts: [string, string, boolean][] = [];
    let i = 0;
    const n = items.length;
    let first = true;
    let pending = " ";
    let rootOnly = false;
    while (i < n) {
      const [compound, next, ok] = this.compound(items, i, first);
      i = next;
      if (!ok) return null;
      let text: string;
      if (first && compound === ":scope") {
        rootOnly = true;
        text = "";
      } else if (first && compound.startsWith(":scope")) {
        text = compound.slice(":scope".length);
        rootOnly = true;
      } else text = compound;
      if (first) parts.push(["", text, rootOnly]);
      else parts.push([pending, text, false]);
      first = false;
      let sawWs = false;
      while (i < n && items[i].t === "ws") {
        sawWs = true;
        i++;
      }
      if (i >= n) break;
      if (items[i].t === "delim" && (items[i].v === ">" || items[i].v === "+" || items[i].v === "~")) {
        pending = ` ${items[i].v} `;
        i++;
        while (i < n && items[i].t === "ws") i++;
        if (i >= n) return null;
      } else if (sawWs) pending = " ";
      else return null;
    }
    let sel = this.prefix;
    parts.forEach(([comb, text, root], k) => {
      if (k === 0) sel += root ? text : " " + text;
      else sel += comb + text;
    });
    return sel;
  }

  compound(items: Tok[], start: number, first: boolean): [string, number, boolean] {
    const n = items.length;
    let i = start;
    const out: string[] = [];
    let t = items[i];
    if (t.t === "ident") {
      const low = lower(t.v);
      const tag = HTML_TAGS.has(low) ? low : Object.prototype.hasOwnProperty.call(SVG_TAGS, low) ? SVG_TAGS[low] : null;
      if (tag === null) return ["", i, false];
      out.push(tag);
      i++;
    } else if (t.t === "delim" && t.v === "*") {
      out.push("*");
      i++;
    }
    while (i < n) {
      t = items[i];
      if (t.t === "delim" && t.v === "." && i + 1 < n && items[i + 1].t === "ident") {
        const cname = items[i + 1].v;
        if (!CLASS_RE.test(cname)) return ["", i, false];
        out.push("." + cname);
        i += 2;
      } else if (t.t === ":") {
        if (i + 1 < n && items[i + 1].t === ":") {
          if (i + 2 < n && items[i + 2].t === "ident" && ["before", "after"].includes(lower(items[i + 2].v))) {
            out.push("::" + lower(items[i + 2].v));
            i += 3;
            if (i < n && items[i].t !== "ws") return ["", i, false];
            continue;
          }
          return ["", i, false];
        }
        if (i + 1 < n && items[i + 1].t === "ident") {
          const name = lower(items[i + 1].v);
          if (name === "scope" && first && out.length === 0) {
            out.push(":scope");
            i += 2;
            continue;
          }
          if (["first-child", "last-child", "only-child", "first-of-type", "last-of-type", "empty"].includes(name)) {
            out.push(":" + name);
            i += 2;
            continue;
          }
          if (name === "before" || name === "after") {
            out.push("::" + name);
            i += 2;
            continue;
          }
          return ["", i, false];
        }
        if (i + 1 < n && items[i + 1].t === "func") {
          const fname = items[i + 1].v;
          const [j, inner] = grabArgs(items, i + 2);
          if (inner === null) return ["", i, false];
          if (["nth-child", "nth-last-child", "nth-of-type", "nth-last-of-type"].includes(fname)) {
            const text = strip(inner.filter((x) => x.t !== "ws").map(nthPiece).join(""));
            if (!/^(?:even|odd|[+-]?[0-9]*n(?:[+-][0-9]+)?|[+-]?[0-9]+)$/.test(text.replace(/ /g, ""))) return ["", i, false];
            out.push(`:${fname}(${text})`);
            i = j;
            continue;
          }
          if (fname === "not") {
            const body = inner.filter((x) => x.t !== "ws");
            if (body.length === 2 && body[0].t === "delim" && body[0].v === "." && body[1].t === "ident" && CLASS_RE.test(body[1].v)) out.push(`:not(.${body[1].v})`);
            else if (body.length === 1 && body[0].t === "ident" && (HTML_TAGS.has(lower(body[0].v)) || Object.prototype.hasOwnProperty.call(SVG_TAGS, lower(body[0].v)))) {
              const low = lower(body[0].v);
              out.push(`:not(${SVG_TAGS[low] ?? low})`);
            } else return ["", i, false];
            i = j;
            continue;
          }
        }
        return ["", i, false];
      } else break;
    }
    if (i === start) return ["", i, false];
    return [out.join(""), i, true];
  }

  // ---- the style sheet
  sheet(toks: Tok[]): string {
    const out: string[] = [];
    let i = 0;
    const n = toks.length;
    while (i < n) {
      while (i < n && toks[i].t === "ws") i++;
      if (i >= n) break;
      if (toks[i].t === "atkw") {
        i = this.atRule(toks, i, out);
        continue;
      }
      let j = i;
      while (j < n && toks[j].t !== "{") j++;
      const prelude = toks.slice(i, j);
      if (j >= n) {
        this.w.add("unfinished", "Removed a rule that has no opening brace.");
        break;
      }
      const end = skipBlock(toks, j);
      const block = blockOf(toks, j, end);
      i = end;
      this.rules++;
      if (this.rules > MAX_RULES) {
        this.w.add("too_many_rules", `Stopped after ${MAX_RULES} rules.`, { max: MAX_RULES });
        break;
      }
      if (prelude.some((t) => t.t === "}" || t.t === "atkw" || t.t === "bad")) {
        this.w.add("rule_selector", "Removed a rule whose selector could not be read.");
        continue;
      }
      const selectors = this.selectorList(prelude);
      if (!selectors.length) continue;
      const decls = this.declarations(block);
      if (decls.length) out.push(selectors.join(",") + "{" + decls.join(";") + "}");
    }
    return out.join("\n");
  }

  atRule(toks: Tok[], i: number, out: string[]): number {
    const name = toks[i].v;
    const n = toks.length;
    let j = i + 1;
    while (j < n && toks[j].t !== "{" && toks[j].t !== ";") j++;
    if (name === "keyframes" && j < n && toks[j].t === "{") {
      const prelude = toks.slice(i + 1, j).filter((t) => t.t !== "ws");
      const end = skipBlock(toks, j);
      const inner = toks[end - 1].t === "}" ? toks.slice(j + 1, end - 1) : toks.slice(j + 1, end);
      if (prelude.length === 1 && prelude[0].t === "ident" && prelude[0].v.startsWith(this.keyframePrefix) && NAME_RE.test(prelude[0].v) && !this.keyframesSeen.has(prelude[0].v)) {
        const steps = this.keyframeSteps(inner);
        if (steps) {
          this.keyframesSeen.add(prelude[0].v);
          out.push(`@keyframes ${prelude[0].v}{${steps}}`);
        }
      } else this.w.add("keyframes_name", `Removed @keyframes: its name must start with "${this.keyframePrefix}".`, { prefix: this.keyframePrefix });
      return end;
    }
    const label = "@" + name;
    this.w.add("at_rule", `Removed ${label}: only @keyframes is allowed.`, { name: label });
    if (j < n && toks[j].t === "{") return skipBlock(toks, j);
    return j + 1;
  }

  keyframeSteps(toks: Tok[]): string {
    const out: string[] = [];
    let i = 0;
    const n = toks.length;
    while (i < n) {
      while (i < n && toks[i].t === "ws") i++;
      if (i >= n) break;
      let j = i;
      while (j < n && toks[j].t !== "{") j++;
      if (j >= n) break;
      const end = skipBlock(toks, j);
      const block = toks[end - 1].t === "}" ? toks.slice(j + 1, end - 1) : toks.slice(j + 1, end);
      let sel: string[] | null = [];
      for (const t of toks.slice(i, j)) {
        if (t.t === "ws") continue;
        if (t.t === "ident" && (lower(t.v) === "from" || lower(t.v) === "to")) sel.push(lower(t.v));
        else if (t.t === "perc" && t.n >= 0 && t.n <= 100) sel.push(num(t.n) + "%");
        else if (t.t === ",") sel.push(",");
        else {
          sel = null;
          break;
        }
      }
      i = end;
      if (!sel || !sel.length || sel[0] === "," || sel[sel.length - 1] === ",") {
        this.w.add("keyframes_step", "Removed a keyframe step that could not be read.");
        continue;
      }
      const decls = this.declarations(block).filter((d) => !d.startsWith("animation"));
      if (decls.length) out.push(sel.join("") + "{" + decls.join(";") + "}");
    }
    return out.join("");
  }
}

export function sanitizeCss(src: unknown, faceId: number, allowedMedia: readonly string[] = [], warn?: Warn, dataStart = 0): SanitizeResult {
  const w = warn ?? new Warn("css");
  const res: SanitizeResult = { value: "", warnings: [], errors: [], dataBytes: 0 };
  if (typeof src !== "string") {
    res.errors.push({ where: "css", code: "type", message: "The CSS must be text." });
    return res;
  }
  if (textBytes(src) > MAX_CSS_BYTES) {
    res.errors.push({ where: "css", code: "too_large", message: `The CSS is larger than ${Math.floor(MAX_CSS_BYTES / 1024)} KB.` });
    return res;
  }
  const ctx = new Css(faceId, allowedMedia, w, dataStart);
  res.value = ctx.sheet(tokeniseCss(stripControls(src)));
  res.warnings = w.out();
  res.dataBytes = ctx.data.n;
  if (ctx.data.n > MAX_DATA_BYTES) res.errors.push({ where: "css", code: "too_much_data", message: "Embedded pictures are larger than 200 KB in total." });
  return res;
}

/** Clean both parts of a face. */
export function sanitizeFace(template: unknown, css: unknown, faceId: number, allowedMedia: readonly string[] = []) {
  const t = sanitizeTemplate(template, allowedMedia);
  const c = sanitizeCss(css, faceId, allowedMedia, undefined, t.dataBytes);
  const errors = [...t.errors, ...c.errors];
  return { template: t.value, css: c.value, warnings: [...t.warnings, ...c.warnings], errors };
}

/** True when a stored template and style sheet come back unchanged: nothing was removed, nothing was rewritten. */
export function isClean(template: string, css: string, faceId: number, allowedMedia: readonly string[] = []): boolean {
  const r = sanitizeFace(template, css, faceId, allowedMedia);
  return r.errors.length === 0 && r.template === template && r.css === css;
}
