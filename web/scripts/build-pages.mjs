// Adds the page styles (77 TOP headers and the below layouts 401 to 477) to the generated design library.
//
//   node scripts/build-pages.mjs            (or npm run build:pages)
//
// Reads the designers' pages scripts/pages/pages_*.html (page styles 1 to 27, recipes in scripts/pages/recipes.mjs) and the hand-made
// designs scripts/pages/lab/*.html (page styles 28 to 77, one file each with its recipe in a <!--recipe {...}--> comment; made from the
// prototypes in design-lab by scripts/pages/import-lab.mjs and finished by hand). Names and descriptions: scripts/pages/lab-names.mjs. Each page is a
//   <section class="page" data-no="1" data-name="…" data-style="…" data-rtl="0|1"><style>…</style><div class="pg p1"><div class="in">…</div></div></section>
// and is cut at its Save button: what is above becomes a TOP header the engine draws in place of the face card, what is
// below becomes a layout of the area under the card. The page's own Save button, share buttons and footer are left out
// (the engine draws its own), its drawn silhouette becomes the card photo, its cover gets the card's cover picture, and
// each repeated group of links is turned into a template that the engine fills from the card's real buttons
// (LIVE / CT / SO / WE, the 12 places of ITEMS, LA(i) for the link attributes and IH(i) for the logo).
//
// Writes (every write replaces what an earlier run left, so running it again gives the same bytes):
//   src/lib/library/generated/pages.js (+ .d.ts)  the headers and layouts as functions of the engine's context
//   src/lib/library/generated/engine.js           one marked block (headers, TOP_COUNT, the layouts pushed onto the below list)
//                                                 and three small in-place additions: P.bio and P.cover, the header branch of
//                                                 renderPage, and TOP_COUNT in the export list
//   src/lib/library/generated/engine.d.ts         TOP_COUNT
//   src/lib/library/generated/meta.ts             BELOW_META grows to 477 entries, TOP_META and PAGES_CSS_URL are added, CSS_URL gets the new hash
//   public/card-library/pages.css                 the pages' rules, scoped under .cfl .pg-tN (its own sheet: a classic card never loads it)
//   public/card-library/designs.css               loses the block an earlier version of this script left in it
//
// Class names of the designers are renamed to pg-<class>, so no page rule can meet a rule of the library or of the app.
// The block sits in front of the Design Pack 2 block in engine.js, so this script and build-pack2.mjs
// can run in either order and both leave the same bytes (build-pack2.test.ts checks that).
// Environment: PAGES_TOLERANT=1 leaves a broken lab design empty instead of stopping; PAGES_LAB_ONLY=28,29 builds only those lab designs (the rest empty).
// Set PAGES_OUT_DIR to write the outputs to another folder instead (used by build-pages.test.ts).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import * as esbuild from "esbuild";
import { ARABIC_SAMPLE, PLACEHOLDER_FIELDS, RECIPES as BASE_RECIPES } from "./pages/recipes.mjs";
import { LAB_NAMES } from "./pages/lab-names.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(WEB, "scripts", "pages");
const GENERATED = path.join(WEB, "src", "lib", "library", "generated");
const PUBLIC = path.join(WEB, "public", "card-library");
const OUT = process.env.PAGES_OUT_DIR ? path.resolve(process.env.PAGES_OUT_DIR) : null;
const VERBOSE = !!process.env.PAGES_VERBOSE;

export const PACK1_BELOW_COUNT = 400;
export const PACK1_INTRO_COUNT = 400;
const ROOT = ".cfl";
/** Page styles 28 and up are the hand-made designs in scripts/pages/lab (one file each, with its recipe in a comment). */
const LAB_DIR = path.join(WEB, "scripts", "pages", "lab");
/** Work on a few lab designs only (the rest become empty stubs) and do not stop at a broken one: PAGES_LAB_ONLY=28,29 PAGES_TOLERANT=1. */
const LAB_ONLY = process.env.PAGES_LAB_ONLY ? new Set(process.env.PAGES_LAB_ONLY.split(",").map(Number)) : null;
const TOLERANT = !!process.env.PAGES_TOLERANT;

/** Opening animations made for the page styles (openings 401 and up). The 400 before them animate the flip card, which a page style does not have. */
const PAGE_INTROS = [
  ["pg-cover", "Cover reveal"],
  ["pg-avatar", "Photo pop"],
  ["pg-cascade", "Buttons cascade"],
  ["pg-focus", "Blur to sharp"],
  ["pg-rise", "Rise and settle"],
  ["pg-glow", "Glow in"],
];
const PREFIX = "pg-";
/** Classes this script adds itself (never prefixed). */
const OWN = new Set(["pg-top", "pg-in", "pg-bt", "pg-ph", "pg-fc"]);
const MARK_START = "/* pages start */";
const MARK_END = "/* pages end */";
const MARK_RE = /\/\* pages start \*\/[\s\S]*?\/\* pages end \*\/\n?/g;

const norm = (s) => s.replace(/\r\n/g, "\n");
const must = (cond, msg) => {
  if (!cond) throw new Error(`build-pages: ${msg}`);
};
const j = (v) => JSON.stringify(v);

// ---- read the designers' files

const files = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter((f) => /^pages_.*\.html$/.test(f)).sort() : [];
must(files.length > 0, `no pages_*.html in ${SRC}`);
const SECTION = /<section class="page"([^>]*)>([\s\S]*?)<\/section>/g;
const ATTR = /data-(\w+)="([^"]*)"/g;
const pages = new Map();
for (const file of files) {
  const text = norm(fs.readFileSync(path.join(SRC, file), "utf8"));
  for (const m of text.matchAll(SECTION)) {
    const a = Object.fromEntries([...m[1].matchAll(ATTR)].map((x) => [x[1], x[2]]));
    const no = Number(a.no);
    must(Number.isInteger(no), `${file}: bad page number ${a.no}`);
    must(!pages.has(no), `page ${no} appears twice`);
    pages.set(no, { file, no, name: (a.name || "").trim(), style: a.style || "", rtl: a.rtl === "1", body: m[2] });
  }
}
const RECIPES = [...BASE_RECIPES];
if (fs.existsSync(LAB_DIR)) {
  for (const file of fs.readdirSync(LAB_DIR).filter((f) => /\.html$/.test(f)).sort()) {
    const text = norm(fs.readFileSync(path.join(LAB_DIR, file), "utf8"));
    const m = /<section class="page"([^>]*)>([\s\S]*)<\/section>/.exec(text);
    must(m, `${file}: no <section class="page">`);
    const a = Object.fromEntries([...m[1].matchAll(ATTR)].map((x) => [x[1], x[2]]));
    const no = Number(a.no);
    must(!pages.has(no), `page ${no} appears twice`);
    const rec = /<!--recipe (\{[\s\S]*?\})-->/.exec(m[2]);
    must(rec, `${file}: no <!--recipe {...}--> comment`);
    const recipe = JSON.parse(rec[1]);
    recipe.no = no;
    recipe.lab = true;
    recipe.sub = (recipe.sub || []).map(([f, t]) => [typeof f === "string" && f.startsWith("re:") ? new RegExp(f.slice(3)) : f, t]);
    pages.set(no, { file, no, name: (a.name || "").trim(), style: a.style || "", rtl: a.rtl === "1", body: m[2] });
    RECIPES.push(recipe);
  }
}
RECIPES.sort((x, y) => x.top - y.top);
export const TOP_COUNT = RECIPES.length;
RECIPES.forEach((r, i) => must(r.top === i + 1, `recipe ${i}: top numbers must run 1..${TOP_COUNT} in order (found ${r.top})`));
for (const r of RECIPES) must(pages.has(r.no), `recipe for page ${r.no}: no such page in ${SRC}`);

const BAD = [/<script/i, /<link/i, /<iframe/i, /<object/i, /<embed/i, /\son\w+\s*=/i, /javascript:/i, /url\((['"]?)\s*(https?:|\/\/)/i, /@import/i, /<use[\s>]/i];

// ---- a small tolerant DOM: elements, text, raw svg bodies, and code (a JavaScript expression that yields markup)

const VOID = new Set(["br", "img", "input", "hr", "wbr", "source", "col", "area", "base", "meta", "param", "track"]);
const ATTRS = /([^\s"'=<>/]+)(?:\s*=\s*"([^"]*)")?/g;

function el(tag, attrs = [], children = []) {
  return { type: "el", tag, attrs, children, attrCode: [], cond: null, alt: null };
}
const text = (t) => ({ type: "text", text: t });
const code = (c) => ({ type: "code", code: c });

function parse(html) {
  const root = el("#root");
  const stack = [root];
  const TAG = /<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g;
  let last = 0;
  let m;
  while ((m = TAG.exec(html))) {
    if (m.index > last) stack[stack.length - 1].children.push(text(html.slice(last, m.index)));
    last = m.index + m[0].length;
    const [, closing, name, rawAttrs] = m;
    if (closing) {
      while (stack.length > 1 && stack[stack.length - 1].tag !== name) stack.pop();
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = [...rawAttrs.matchAll(ATTRS)].filter((x) => x[1] !== "/").map((x) => [x[1], x[2] ?? null]);
    const node = el(name, attrs);
    stack[stack.length - 1].children.push(node);
    if (name === "svg") {
      // the drawing inside an svg is kept as it is
      const end = html.indexOf("</svg>", last);
      must(end > 0, "an <svg> is never closed");
      node.children.push({ type: "raw", text: html.slice(last, end) });
      last = end + 6;
      TAG.lastIndex = last;
      continue;
    }
    if (!VOID.has(name) && !rawAttrs.trim().endsWith("/")) stack.push(node);
  }
  if (last < html.length) root.children.push(text(html.slice(last)));
  return root;
}

const classes = (n) => ((n.attrs.find((a) => a[0] === "class") || [])[1] || "").split(/\s+/).filter(Boolean);
const hasClass = (n, c) => n.type === "el" && classes(n).includes(c);
const setClasses = (n, list) => {
  const i = n.attrs.findIndex((a) => a[0] === "class");
  if (list.length === 0) {
    if (i >= 0) n.attrs.splice(i, 1);
  } else if (i >= 0) n.attrs[i][1] = list.join(" ");
  else n.attrs.push(["class", list.join(" ")]);
};
const addClass = (n, c) => setClasses(n, [...classes(n).filter((x) => x !== c), c]);
const elements = (n) => n.children.filter((c) => c.type === "el");

/** Every element of the subtree (pre-order), the node itself first. */
function walk(n, fn) {
  if (n.type !== "el") return;
  fn(n);
  for (const c of n.children) walk(c, fn);
}
function find(n, pred) {
  let hit = null;
  walk(n, (x) => {
    if (!hit && x !== n && pred(x)) hit = x;
  });
  return hit;
}
function findAll(n, pred) {
  const out = [];
  walk(n, (x) => {
    if (x !== n && pred(x)) out.push(x);
  });
  return out;
}
function parentOf(root, node) {
  let hit = null;
  walk(root, (x) => {
    if (!hit && x.children.includes(node)) hit = x;
  });
  return hit;
}
function remove(root, node) {
  const p = parentOf(root, node);
  if (p) p.children.splice(p.children.indexOf(node), 1);
}
function replace(root, node, next) {
  const p = parentOf(root, node);
  must(p, "node to replace is not in the tree");
  next.bottom = node.bottom;
  p.children.splice(p.children.indexOf(node), 1, next);
}

/** The visible text of a node (svg drawings count as nothing). */
function textOf(n) {
  if (n.type === "text") return n.text;
  if (n.type === "el" && n.tag !== "svg") return n.children.map(textOf).join("");
  return "";
}
/** Text nodes with something in them, outside svg drawings, in order. */
function leaves(n, out = []) {
  if (n.type === "text") {
    if (n.text.trim()) out.push(n);
  } else if (n.type === "el" && n.tag !== "svg") n.children.forEach((c) => leaves(c, out));
  return out;
}
const hasSvg = (n) => n.type === "el" && (n.tag === "svg" || !!find(n, (x) => x.tag === "svg"));

// ---- turning a tree into one JavaScript expression

const PH = /\{(\w+)\}/g;
const PH_ONE = /\{(\w+)\}/;
const SEP = "[·,،—–-]";
const JOIN_ALL = new RegExp(`^(\\{\\w+\\})(\\s*${SEP}\\s*\\{\\w+\\})+$`);
const SEP_ONE = new RegExp(`^(\\s*${SEP}\\s*)\\{(\\w+)\\}$`);

/** The field expression for a placeholder. */
function fieldOf(name, no) {
  must(name in PLACEHOLDER_FIELDS, `page ${no}: unknown placeholder {${name}}`);
  return `P.${PLACEHOLDER_FIELDS[name]}`;
}

/** Parts of a text node: strings, and expressions for the placeholders in it. Separators next to an empty value go with it. */
const BI = /\[\[([^|\]]*)\|([^\]]*)\]\]/g;
function textParts(t, no) {
  if (/\[\[[^|\]]*\|[^\]]*\]\]/.test(t)) {
    const out = [];
    let at = 0;
    for (const m of t.matchAll(BI)) {
      if (m.index > at) out.push(...textParts(t.slice(at, m.index), no));
      out.push({ expr: `c.ar?${j(m[2])}:${j(m[1])}` });
      at = m.index + m[0].length;
    }
    if (at < t.length) out.push(...textParts(t.slice(at), no));
    return out;
  }
  const s = t.trim();
  if (JOIN_ALL.test(s)) {
    const sep = /\s*[·,،—–-]\s*/.exec(s)[0];
    const fields = [...s.matchAll(PH)].map((m) => fieldOf(m[1], no));
    const lead = t.slice(0, t.indexOf(s));
    const tail = t.slice(t.indexOf(s) + s.length);
    return [lead, { expr: `[${fields.join(",")}].filter(Boolean).join(${j(sep)})` }, tail].filter((x) => x !== "");
  }
  const one = SEP_ONE.exec(s);
  if (one) {
    const f = fieldOf(one[2], no);
    return [{ expr: `(${f}?${j(one[1])}+${f}:"")` }];
  }
  const parts = [];
  let last = 0;
  for (const m of t.matchAll(PH)) {
    if (m.index > last) parts.push(t.slice(last, m.index));
    parts.push({ expr: fieldOf(m[1], no) });
    last = m.index + m[0].length;
  }
  if (last < t.length) parts.push(t.slice(last));
  return parts;
}

/** Joins literal strings and expressions into one expression. */
function toExpr(parts) {
  const out = [];
  let lit = "";
  for (const p of parts) {
    if (typeof p === "string") lit += p;
    else {
      if (lit) out.push(j(lit));
      lit = "";
      out.push(`(${p.expr})`);
    }
  }
  if (lit) out.push(j(lit));
  return out.length ? out.join("+") : '""';
}

function renameClass(c, no) {
  must(/^[a-zA-Z][\w-]*$/.test(c), `page ${no}: odd class name "${c}"`);
  if (OWN.has(c) || c === "pic") return c;
  must(!c.startsWith(PREFIX), `page ${no}: class names may not start with ${PREFIX}`);
  return PREFIX + c;
}

/** The parts of a node's markup. */
function emit(n, no, parts = []) {
  if (n.type === "text") {
    parts.push(...textParts(n.text, no));
    return parts;
  }
  if (n.type === "raw") {
    parts.push(n.text);
    return parts;
  }
  if (n.type === "code") {
    parts.push({ expr: n.code });
    return parts;
  }
  if (n.tag === "#root") {
    n.children.forEach((c) => emit(c, no, parts));
    return parts;
  }
  const inner = [];
  inner.push(`<${n.tag}`);
  for (const [k, v] of n.attrs) {
    if (k === "class") inner.push(` class="${v.split(/\s+/).filter(Boolean).map((c) => renameClass(c, no)).join(" ")}"`);
    else if (v !== null && /\[\[[^|\]]*\|[^\]]*\]\]/.test(v)) {
      // a bilingual word inside an attribute value (aria-label, title)
      inner.push(` ${k}="`);
      let at = 0;
      for (const m of v.matchAll(BI)) {
        if (m.index > at) inner.push(v.slice(at, m.index));
        inner.push({ expr: `c.ar?${j(m[2])}:${j(m[1])}` });
        at = m.index + m[0].length;
      }
      if (at < v.length) inner.push(v.slice(at));
      inner.push('"');
    } else inner.push(v === null ? ` ${k}` : ` ${k}="${v}"`);
  }
  for (const c of n.attrCode) inner.push({ expr: c });
  inner.push(">");
  if (!VOID.has(n.tag)) {
    n.children.forEach((c) => emit(c, no, inner));
    inner.push(`</${n.tag}>`);
  }
  let expr = null;
  if (n.alt) expr = `(${n.alt}||(${toExpr(inner)}))`;
  if (n.cond) expr = `(${n.cond}?${expr ?? toExpr(inner)}:"")`;
  if (expr) parts.push({ expr });
  else parts.push(...inner);
  return parts;
}

// ---- cutting a page: chrome that goes, the Save button that splits it, the avatar, the cover, the Blinq card

/** Elements that are only the designer's chrome: the Save button (the engine draws it), share and exchange buttons, the footer. */
const CHROME = /Save Contact|Save contact|Save my card|^\s*Save\s*$|Share your details|Share details|^\s*Share\s*$|Exchange|Powered by|POWERED BY|حفظ جهة|شارك بياناتك|تبادل البيانات|مدعوم من|Swipe up|Tap to share|رمز QR/;
const isChrome = (n) => CHROME.test(textOf(n).replace(/\[\[([^|\]]*)\|[^\]]*\]\]/g, "$1").replace(/\s+/g, " "));

/** Remove the elements that are wholly about the Save/Share/Exchange buttons or the footer. */
function dropChrome(root) {
  const go = (n) => {
    for (const c of elements(n)) {
      if (isChrome(c)) {
        const textKids = elements(c).filter((k) => leaves(k).length);
        if (!textKids.length || textKids.every(isChrome)) {
          n.children.splice(n.children.indexOf(c), 1);
          continue;
        }
      }
      go(c);
    }
  };
  go(root);
}

function dropByRecipe(root, list = []) {
  for (const key of list) {
    for (const n of findAll(root, (x) => hasClass(x, key) || (x.tag === key && classes(x).length === 0))) remove(root, n);
  }
}

/** The card photo in place of the drawn silhouette (the first svg inside the avatar element, or the element's content). */
function placeAvatar(root, cls, no) {
  const av = find(root, (x) => hasClass(x, cls));
  must(av, `page ${no}: no avatar element .${cls}`);
  const svg = av.tag === "svg" ? av : find(av, (x) => x.tag === "svg");
  if (svg && svg !== av) {
    const host = parentOf(root, svg);
    host.children.splice(host.children.indexOf(svg), 1, code("c.pic()"));
    addClass(host, "pg-ph");
  } else {
    av.children = [code("c.pic()")];
    addClass(av, "pg-ph");
  }
}

/** The card's cover picture fills the cover element; the drawn art inside it is left out while a picture is shown. */
function placeCover(root, cls, art, no) {
  const cov = find(root, (x) => hasClass(x, cls));
  must(cov, `page ${no}: no cover element .${cls}`);
  const i = cov.attrs.findIndex((a) => a[0] === "style");
  const own = i >= 0 ? cov.attrs.splice(i, 1)[0][1].replace(/;?\s*$/, ";") : "";
  cov.attrCode.push(`(P.cover?' style="${own}background:url('+P.cover+') center/cover"':${j(own ? ` style="${own}"` : "")})`);
  for (const c of elements(cov)) {
    if (art.includes(c.tag) || classes(c).some((k) => art.includes(k))) c.cond = "!P.cover";
  }
}

/** Elements whose only text is one placeholder are drawn only when that field has a value. */
/** An element that holds generated markup (the card photo, a list) is never hidden just because its one text is empty. */
const holdsCode = (n) => n.type === "code" || (n.type === "el" && n.children.some(holdsCode));
function condEmpty(n) {
  if (n.type !== "el" || n.tag === "svg") return;
  // data-keep: this element is never hidden for its one empty text (it also holds artwork); the text inside is hidden instead
  if (n.attrs.some((x) => x[0] === "data-keep")) {
    n.children.forEach(condEmpty);
    return;
  }
  const ls = leaves(n);
  if (ls.length === 1 && n.tag !== "#root" && !holdsCode(n)) {
    const m = /^\s*\{(\w+)\}\s*$/.exec(ls[0].text);
    if (m && m[1] !== "name" && m[1] !== "first" && m[1] !== "last" && m[1] !== "ini" && m[1] !== "mono") {
      if (!n.cond) n.cond = `P.${PLACEHOLDER_FIELDS[m[1]]}`;
      return;
    }
  }
  n.children.forEach(condEmpty);
}

// ---- repeated groups of links become templates filled from the card's buttons

const LABELS = /^(Website|Mobile|Email|E-mail|Phone|Web|Office|Address|LinkedIn|Instagram|WhatsApp|Directions|Calendar|Book.*|Direct line|Work email|Company site|Head office|Mobile · WhatsApp|Website · LinkedIn|Connect|Follow|in)$/i;
const BRANDY = new Set(["li", "ig", "wa", "wb", "ma", "ml", "web", "ac", "a"]);
const SOURCES = {
  all: "c.LIVE",
  contact: "c.CT",
  social: "c.SO",
  web: "c.WE",
  nonContact: "c.SO.concat(c.WE)",
  quick: "c.LV([0,1,2,4])",
  nonQuick: "(function(q){return c.LIVE.filter(function(i){return q.indexOf(i)<0})})(c.LV([0,1,2,4]))",
  rest: "c.LIVE.filter(function(i){return !u[i.x]})",
};

/** The template of one button: the first repeated child, with its icon, label and value replaced by the item's. */
function templateOf(sample, spec, no) {
  const t = sample;
  const strip = (n) => setClasses(n, classes(n).filter((k) => !BRANDY.has(k)));
  // the icon: the first child that draws something, before any text
  let iconHost = null;
  let tint = spec.tint || null;
  const firstLeaf = leaves(t)[0] || null;
  const before = (n) => {
    if (!firstLeaf) return true;
    let seen = false;
    let hit = false;
    walk(t, (x) => {
      if (x === n && !seen) hit = true;
      if (leaves(x).includes(firstLeaf) && x !== t && !x.children.some((c) => c.type === "el" && leaves(c).includes(firstLeaf))) seen = true;
    });
    return hit;
  };
  if (!elements(t).some(hasSvg) && textOf(t).trim() === "in") iconHost = t;
  else for (const c of elements(t)) {
    if ((hasSvg(c) || textOf(c).trim() === "in") && before(c)) {
      iconHost = c;
      break;
    }
    const inner = find(c, (x) => (hasSvg(x) || textOf(x).trim() === "in") && x.tag !== "svg" || x.tag === "svg");
    if (inner && before(inner) && !leaves(c).some((l) => !find(inner, () => false) && !textOf(inner).includes(l.text))) {
      iconHost = inner.tag === "svg" ? inner : inner;
      break;
    }
  }
  // an icon that comes after the words (a trailing arrow or glyph) is the button's icon as well
  if (!iconHost) {
    const late = elements(t).find((c) => hasSvg(c) && leaves(c).length === 0);
    if (late) iconHost = late;
  }
  if (iconHost) {
    const hostClasses = classes(iconHost);
    const brandy = hostClasses.some((k) => BRANDY.has(k)) || classes(t).some((k) => BRANDY.has(k));
    const styleAt = iconHost.attrs.findIndex((a) => a[0] === "style");
    if (!tint) tint = brandy ? "bg" : styleAt >= 0 && /color:#/.test(iconHost.attrs[styleAt][1]) ? "fg" : "none";
    if (styleAt >= 0 && tint !== "none") iconHost.attrs.splice(styleAt, 1);
    strip(iconHost);
    if (iconHost.tag === "svg") {
      const p = parentOf(t, iconHost) || t;
      p.children.splice(p.children.indexOf(iconHost), 1, code("c.IH(i)"));
      if (tint === "bg") p.attrCode.push(`' style="background:'+i.dot+';color:'+i.ink+'"'`);
      else if (tint === "fg") p.attrCode.push(`' style="color:'+i.dot+'"'`);
    } else {
      iconHost.children = [code("c.IH(i)")];
      if (tint === "bg") iconHost.attrCode.push(`' style="background:'+i.dot+';color:'+i.ink+'"'`);
      else if (tint === "fg") iconHost.attrCode.push(`' style="color:'+i.dot+'"'`);
    }
  }
  strip(t);
  // the words: a number, then the label and the value
  const ls = leaves(t).filter((l) => !iconHost || !leaves(iconHost).includes(l));
  const texts = [];
  for (const l of ls) {
    if (/^\s*0\d\s*$/.test(l.text)) l.text = "@@num@@";
    else texts.push(l);
  }
  const withPh = texts.filter((l) => PH_ONE.test(l.text) || !LABELS.test(l.text.trim()));
  let label = null;
  let value = null;
  if (texts.length === 1) {
    const one = texts[0];
    label = spec.role === "icons" ? "s" : spec.text === "value" ? "v" : "l";
    one.text = `@@${label}@@`;
  } else if (texts.length >= 2) {
    const v = withPh.find((l) => PH_ONE.test(l.text)) || texts[1];
    const lab = texts.find((l) => l !== v);
    lab.text = "@@l@@";
    v.text = "@@v@@";
    label = "l";
    value = "v";
    for (const extra of texts) if (extra !== v && extra !== lab) extra.text = "";
  }
  // the whole thing is a link
  t.tag = "a";
  t.attrs = t.attrs.filter((a) => a[0] !== "href");
  t.attrCode.unshift("c.LA(i)");
  if (!label) t.attrCode.push(`' aria-label="'+i.l+'"'`);
  void value;
  const parts = emit(t, no);
  const expr = toExpr(parts)
    .split('@@num@@').join('"+("0"+(k+1)).slice(-2)+"')
    .split("@@l@@").join('"+i.l+"')
    .split("@@s@@").join('"+i.s+"')
    .split("@@v@@").join('"+i.v+"');
  return expr;
}

/** Replace a group of links in the tree by code that draws the template for every button of the source. */
function placeList(root, spec, no) {
  const source = SOURCES[spec.items || "rest"];
  must(source, `page ${no}: unknown items source "${spec.items}"`);
  const hits = findAll(root, (x) => hasClass(x, spec.c));
  must(hits.length, `page ${no}: no .${spec.c} for a list`);
  let container = hits[0];
  let repeated;
  let siblings = false;
  if (spec.template) {
    repeated = findAll(container, (x) => hasClass(x, spec.template));
  } else {
    const p = parentOf(root, container);
    const same = elements(p).filter((x) => hasClass(x, spec.c));
    if (same.length > 1) {
      siblings = true;
      repeated = same;
    } else repeated = elements(container);
  }
  must(repeated.length, `page ${no}: .${spec.c} has nothing that repeats`);
  const sample = repeated[0];
  const holder = parentOf(root, sample);
  for (const r of repeated.slice(1)) remove(root, r);
  const tmpl = templateOf(sample, spec, no);
  const list = `(${source}).map(function(i,k){u[i.x]=1;return ${tmpl}}).join("")`;
  if (siblings || spec.template) {
    holder.children.splice(holder.children.indexOf(sample), 1, code(list));
    return;
  }
  holder.children.splice(holder.children.indexOf(sample), 1, code("{{list}}"));
  // the container (or, with a template class, the whole group) goes when the source is empty
  container.cond = "L.length";
  const parts = emit(container, no);
  const expr = toExpr(parts).split('"+({{list}})+"').join(`"+${list.replace(`(${source})`, "L")}+"`).split("({{list}})").join(list.replace(`(${source})`, "L"));
  replace(root, container, code(`(function(L){return ${expr}})(${source})`));
}

// ---- one page

function convert(page, recipe) {
  const { no } = page;
  const styleStart = page.body.indexOf("<style>");
  const styleEnd = page.body.indexOf("</style>");
  must(styleStart >= 0 && styleEnd > styleStart, `page ${no}: no <style> block`);
  let css = page.body.slice(styleStart + 7, styleEnd);
  let markup = page.body.slice(styleEnd + 8).trim().replace(/<!--[\s\S]*?-->/g, "");
  // background pictures of the lab designs (public/card-library/art/*.webp): the file must exist, and its address carries a hash of its
  // bytes because /card-library is cached for a year as immutable
  css = css.replace(/url\((['"]?)\/card-library\/art\/([\w.-]+\.webp)\1\)/g, (m, q, name) => {
    const file = path.join(PUBLIC, "art", name);
    must(fs.existsSync(file), `page ${no}: picture not found: ${name}`);
    return `url(${q}/card-library/art/${name}?v=${crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 8)}${q})`;
  });
  for (const re of BAD) must(!re.test(markup) && !re.test(css), `page ${no}: not allowed in a page: ${re}`);
  // the separators written as entities are the same characters the smart join of "{a} · {b}" looks for
  markup = markup.replace(/&middot;/g, "·").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&bull;/g, "•");
  for (const [from, to] of ARABIC_SAMPLE) markup = markup.split(from).join(to);
  for (const [from, to] of recipe.sub || []) {
    must(from instanceof RegExp ? from.test(markup) : markup.includes(from), `page ${no}: text to replace not found: ${from}`);
    markup = from instanceof RegExp ? markup.replace(from, to) : markup.split(from).join(to);
  }
  // ids of inline svg (gradients, patterns) are made unique to the page
  const ids = [...markup.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
  must(new Set(ids).size === ids.length, `page ${no}: an id is used twice`);
  for (const id of ids) {
    const fresh = `pg${no}-${id}`;
    const ref = new RegExp(`(url\\(#|href="#)${id}(?=[)"])`, "g");
    markup = markup.replace(new RegExp(`(\\sid=")${id}(?=")`, "g"), `$1${fresh}`).replace(ref, `$1${fresh}`);
    css = css.replace(ref, `$1${fresh}`);
  }

  const root = parse(markup);
  const pg = elements(root)[0];
  must(pg && hasClass(pg, `p${no}`), `page ${no}: the markup must start with <div class="pg p${no}">`);
  const inn = elements(pg)[0];
  must(inn && hasClass(inn, "in"), `page ${no}: no .in element`);
  const auto = recipe.dir === "auto";
  const rtl = !auto && (recipe.dir === "rtl" || page.rtl || inn.attrs.some((a) => a[0] === "dir" && a[1] === "rtl"));

  // where the page is cut: the first block that holds the Save button (or the one the recipe names)
  const kids = elements(inn);
  const at = recipe.split ? kids.findIndex((k) => hasClass(k, recipe.split)) : kids.findIndex((k) => /Save|حفظ جهة/.test(textOf(k)));
  must(at > 0, `page ${no}: no Save button to cut the page at`);
  for (const k of kids.slice(at)) k.bottom = true;

  if (!recipe.keepTop) dropByRecipe(inn, ["top"]);
  dropByRecipe(inn, recipe.drop);
  dropChrome(inn);
  if (recipe.avatar) placeAvatar(inn, recipe.avatar, no);
  if (recipe.cover) placeCover(inn, recipe.cover, recipe.coverArt || [], no);
  for (const [cls, field] of Object.entries(recipe.cond || {})) {
    const n = find(inn, (x) => hasClass(x, cls));
    must(n, `page ${no}: no .${cls} to make conditional`);
    n.cond = `P.${field}`;
  }
  for (const spec of recipe.lists || []) placeList(inn, spec, no);
  if (recipe.blinq) {
    const card = find(inn, (x) => hasClass(x, recipe.blinq));
    must(card, `page ${no}: no .${recipe.blinq} card block`);
    card.alt = "c.face";
  }
  condEmpty(inn);

  const topKids = inn.children.filter((k) => !k.bottom);
  const botKids = inn.children.filter((k) => k.bottom && k.type !== "text");
  const dir = rtl ? ' dir="rtl"' : "";
  const wrap = (cls, children, style) => {
    // pg-nl1 / pg-nl2 / pg-nl3: the name has up to 15, 16 to 24, or more than 24 characters; pg-wl1 / 2 / 3: its longest word has up to 9, 10 to 12, or more than 12 (hooks for sizing long names)
    const sizing = /\.(nl|wl)[123]/.test(css) ? [{ expr: 'P.name.length>24?" pg-nl3":P.name.length>15?" pg-nl2":" pg-nl1"' }, { expr: '(function(w){return w>12?" pg-wl3":w>9?" pg-wl2":" pg-wl1"})(Math.max.apply(0,P.name.split(/\\s+/).map(function(x){return x.length})))' }] : [];
    const parts = [`<div class="${cls} pg-t${recipe.top}`, ...sizing, `"${dir}`, ...(auto ? [{ expr: `' dir="'+(c.ar?"rtl":"ltr")+'"'` }] : []), ...(style ? [{ expr: style }] : []), `><div class="pg-in">`];
    children.forEach((c) => emit(c, no, parts));
    parts.push("</div></div>");
    return toExpr(parts);
  };
  const topExpr = wrap("pg-top", topKids);
  const hasBottom = botKids.length > 0;
  const botExpr = hasBottom ? wrap("pg-bt", botKids, `' style="'+c.vars+'"'`) : '""';
  const fn = (expr) => `function(c){var P=c.P,u={};return ${expr}}`;

  // the words that stay fixed in the markup, for the report and the sample-text check
  const fixed = [];
  const collect = (n) => {
    if (n.type === "text" && n.text.trim() && !/^\s*\{\w+\}\s*$/.test(n.text)) fixed.push(n.text.trim().replace(/\[\[([^|\]]*)\|[^\]]*\]\]/g, "$1").replace(/\{\w+\}/g, "_"));
    if (n.type === "el" && n.tag !== "svg") n.children.forEach(collect);
  };
  inn.children.forEach(collect);
  must(!/[؀-ۿ]/.test(fixed.join(" ")), `page ${no}: Arabic sample text left: ${fixed.filter((f) => /[؀-ۿ]/.test(f)).join(" | ")}`);
  must(!/Doha|Dubai|Qatar|Lusail|West Bay|Msheireb|\+974|she \/ her|Employee|Verified|MEMBER|ATTENDEE|PINNED|STORY|SINCE|GMT|Online now|NFC|Personal card|Image card|Official|BRAND|REF/.test(fixed.join(" ")), `page ${no}: sample text left: ${fixed.join(" | ")}`);

  const fonts = [...new Set([...css.matchAll(/font-family:([^;}]*)/g)].flatMap((m) => m[1].split(",").map((f) => f.trim().replace(/^['"]|['"]$/g, ""))))].filter((f) => !/^(sans-serif|serif|monospace|inherit|system-ui)$/.test(f));
  return { no, top: recipe.top, name: page.name, style: recipe.style, rtl, blinq: !!recipe.blinq, topExpr: fn(topExpr), botExpr: fn(botExpr), css, fixed, fonts, hasBottom };
}

// ---- rules: scoped under .cfl .pg-tN, designer classes renamed

function scopeCss(css, no, top) {
  const tree = postcss.parse(css);
  const rootRe = new RegExp(`\\.p${no}(?![\\w-])`, "g");
  tree.walkAtRules((at) => {
    if (/^keyframes$/i.test(at.name)) {
      at.params = `pg${top}-${at.params.trim()}`;
      return;
    }
    if (/^(media|supports)$/i.test(at.name)) return;
    throw new Error(`build-pages: page ${no}: @${at.name} is not allowed in a page`);
  });
  const frames = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  tree.walkDecls((d) => {
    must(!/url\((['"]?)\s*(https?:|\/\/)/i.test(d.value), `page ${no}: a rule loads something from the web: ${d.prop}`);
    if (/^animation(-name)?$/.test(d.prop)) for (const f of frames) d.value = d.value.replace(new RegExp(`(^|[\\s,])${f}(?![\\w-])`, "g"), `$1pg${top}-${f}`);
  });
  tree.walkRules((rule) => {
    if (rule.parent && rule.parent.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    rule.selectors = rule.selectors.map((sel) => {
      const s = sel.trim();
      must(rootRe.test(s) && s.startsWith(`.p${no}`), `page ${no}: selector not scoped under .p${no}: ${s}`);
      rootRe.lastIndex = 0;
      const renamed = s.replace(rootRe, "\u0000").replace(/\.(-?[_a-zA-Z][\w-]*)/g, (w, c) => `.${renameClass(c, no)}`);
      return renamed.replace(/\u0000/g, `${ROOT} .pg-t${top}`);
    });
  });
  return tree.toString();
}

/** Rules shared by every header and layout: the containers, the photo disc, the opening animation, the face card inside a Blinq header. */
const BASE_CSS = `
${ROOT} .pg-top,${ROOT} .pg-bt{container-type:inline-size;position:relative;width:100%;overflow:hidden;background:var(--cbg);color:var(--cfg);border-radius:18px;box-shadow:0 1.4cqw 4cqw var(--pgsh,#00000038),0 0 0 1px var(--pgline,#80808040)}
${ROOT} .pg-bt{border-radius:14px}
${ROOT} .pg-in{position:relative;display:flex;flex-direction:column;min-height:0}
${ROOT} .pg-top .pg-in{min-height:0}
${ROOT} .pg-ph{container-type:inline-size;overflow:hidden}
${ROOT} .pg-ph .pic{width:100%;height:100%;font-size:38cqw;border-radius:inherit}
${ROOT} .pg-ph img.pic{object-fit:cover;object-position:50% 22%}
${ROOT} .pg-fc{padding:2cqw 5cqw 4cqw}
${ROOT} .pg-fc .card{aspect-ratio:7/4}
${ROOT} .stg.go .pg-top{animation:iFadeUp 1s cubic-bezier(.2,.7,.2,1) both}
${ROOT} .stg.go[class*="in-pg-"] .pg-top{animation:none}
@keyframes pgCover{from{opacity:0;transform:translateY(-28px) scale(.97)}to{opacity:1;transform:none}}
@keyframes pgPop{0%{opacity:0;transform:scale(.55)}65%{opacity:1;transform:scale(1.08)}100%{opacity:1;transform:none}}
@keyframes pgIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes pgFocus{from{opacity:0;filter:blur(16px);transform:scale(1.03)}to{opacity:1;filter:none;transform:none}}
@keyframes pgRise{from{opacity:0;transform:translateY(46px)}to{opacity:1;transform:none}}
@keyframes pgGlow{0%{opacity:0;box-shadow:0 0 0 0 var(--pacc)}60%{opacity:1;box-shadow:0 0 40px 6px var(--pacc)}100%{opacity:1;box-shadow:none}}
${ROOT} .stg.go.in-pg-cover .pg-top{animation:pgCover .9s cubic-bezier(.2,.8,.2,1) both}
${ROOT} .stg.go.in-pg-avatar .pg-top{animation:pgIn .5s ease both}
${ROOT} .stg.go.in-pg-avatar .pg-top .pic,${ROOT} .stg.go.in-pg-avatar .pg-top .pg-ph{animation:pgPop .9s cubic-bezier(.3,1.4,.4,1) .25s both}
${ROOT} .stg.go.in-pg-cascade .pg-top{animation:pgIn .6s ease both}
${ROOT} .stg.go.in-pg-cascade ~ .dv a,${ROOT} .stg.go.in-pg-cascade ~ .pg-bt a{animation:pgIn .55s ease both}
${ROOT} .stg.go.in-pg-cascade ~ .dv a:nth-of-type(1){animation-delay:.25s}
${ROOT} .stg.go.in-pg-cascade ~ .dv a:nth-of-type(2){animation-delay:.35s}
${ROOT} .stg.go.in-pg-cascade ~ .dv a:nth-of-type(3){animation-delay:.45s}
${ROOT} .stg.go.in-pg-cascade ~ .dv a:nth-of-type(4){animation-delay:.55s}
${ROOT} .stg.go.in-pg-cascade ~ .dv a:nth-of-type(5){animation-delay:.65s}
${ROOT} .stg.go.in-pg-cascade ~ .dv a:nth-of-type(n+6){animation-delay:.75s}
${ROOT} .stg.go.in-pg-focus .pg-top{animation:pgFocus 1s ease-out both}
${ROOT} .stg.go.in-pg-rise .pg-top{animation:pgRise .9s cubic-bezier(.15,.9,.25,1) both}
${ROOT} .stg.go.in-pg-glow .pg-top{animation:pgGlow 1.3s ease-out both}
@media (prefers-reduced-motion:reduce){${ROOT} .stg.go[class*="in-pg-"] .pg-top,${ROOT} .stg.go[class*="in-pg-"] .pg-top *,${ROOT} .stg.go[class*="in-pg-"] ~ .dv a{animation:none}}
${ROOT} .stg .pg-top a,${ROOT} .pg-bt a{color:inherit;text-decoration:none}
${ROOT} .pg-bt .pg-in>:first-child{margin-top:0}
${ROOT} .pg-top svg,${ROOT} .pg-bt svg{flex:none}
`;

// ---- build every page

function stub(r, why) {
  console.warn(`build-pages: design ${r.top} (${r.name || r.no}) left empty: ${why}`);
  return { no: r.no, top: r.top, name: r.name || String(r.no), style: r.style || "Lab", rtl: false, blinq: false, topExpr: 'function(c){return ""}', botExpr: 'function(c){return ""}', css: "", fixed: [], fonts: [], hasBottom: false, stub: true };
}
const built = RECIPES.map((r) => {
  if (r.lab && LAB_ONLY && !LAB_ONLY.has(r.top)) return stub(r, "not selected (PAGES_LAB_ONLY)");
  try {
    return convert(pages.get(r.no), r);
  } catch (e) {
    if (!(r.lab && TOLERANT)) throw e;
    return stub(r, e.message);
  }
});
for (const b of built) if (LAB_NAMES[b.top]) b.name = LAB_NAMES[b.top].en;
const cssParts = [BASE_CSS];
for (const b of built) cssParts.push(scopeCss(b.css, b.no, b.top));
const fontsUsed = [...new Set(built.flatMap((b) => b.fonts))].sort();
if (VERBOSE) for (const b of built) console.log(`page ${b.no} -> top ${b.top}: fixed words: ${b.fixed.join(" | ") || "(none)"}`);

// ---- pages.js and pages.d.ts

const topDesc = (b) => (LAB_NAMES[b.top] ? LAB_NAMES[b.top].de : `${b.style}-style header: ${b.name}`);
const topSrc = built.map((b) => `{n:${j(b.name)},s:${j(b.style)},d:${j(topDesc(b))},rtl:${b.rtl},b:${b.blinq},h:${b.topExpr}}`);
const belowSrc = built.map((b) => `{n:${j(`${b.name} buttons`)},d:${j(`The buttons of the ${b.name} page, under its header.`)},h:${b.botExpr}}`);
const pagesSource = `var PAGES={top:[${topSrc.join(",\n")}],below:[${belowSrc.join(",\n")}]};\nexport default PAGES;\n`;
// the generated functions are checked for syntax before anything is written
new Function(pagesSource.replace(/^export default PAGES;$/m, ""));
const pagesMin = esbuild.transformSync(pagesSource, { minify: true, format: "esm", target: "es2019", legalComments: "none" }).code;
const header = "// Generated by scripts/build-pages.mjs from scripts/pages/pages_*.html. Do not edit.\n";
const pagesDts = `${header}/** What a page header or layout draws with: the person, the buttons, and the engine's own helpers. */
export interface PagesContext {
  P: Record<string, string>;
  LIVE: unknown[]; CT: unknown[]; SO: unknown[]; WE: unknown[]; ITEMS: unknown[];
  LV: (slots: number[]) => unknown[];
  LA: (item: unknown) => string;
  IH: (item: unknown) => string;
  pic: () => string;
  thumb: boolean;
  /** The card colour variables as an inline style. */
  vars: string;
  /** The chosen face card, for Blinq-style headers (empty when the palette block is shown). */
  face: string;
  /** The card is in Arabic. */
  ar: boolean;
}
export interface PageTop { n: string; s: string; d: string; rtl: boolean; b: boolean; h: (c: PagesContext) => string }
export interface PageBelow { n: string; d: string; h: (c: PagesContext) => string }
declare const PAGES: { top: PageTop[]; below: PageBelow[] };
export default PAGES;
`;

// ---- engine.js: the marked block, and the small additions in place

function names(engine) {
  const take = (re, what) => {
    const m = re.exec(engine);
    must(m, `engine.js: ${what} not found`);
    return m;
  };
  const tab = take(/return (\w+)\((\w+)\),(\w+)\((\w+)==="c"\?(\w+):\4==="s"\?(\w+):(\w+)\)\}/, "the tab groups");
  const live = take(/var (\w+)=(\w+)\.filter\(function\((\w+)\)\{return \w+\.indexOf\('data-i="'\+\3\.x\+'"'\)<0\}\)/, "the live list");
  const lv = take(/function (\w+)\((\w+)\)\{return \2\.map\(function\((\w+)\)\{return (\w+)\[\3\]\}\)\.filter\(function\((\w+)\)\{return \5&&!\5\.z\}\)\}/, "LV and ITEMS");
  const la = take(/function (\w+)\((\w+)\)\{if\(\2\.z\)return' data-z="1"'/, "LA");
  const ih = take(/function (\w+)\((\w+)\)\{return \2\.ih\|\|""\}/, "IH");
  const pic = take(/function (\w+)\(\)\{return (\w+)\?'<img class="pic" alt="" src="'\+\2\+'">':'<span class="pic">'\+(\w+)\.ini\+"<\/span>"\}/, "pic");
  const mode = take(/(\w+)==="thumb"\?/, "MODE");
  const ops = take(/var (\w+)=\[\["fade-up","Fade up"\]/, "the openings");
  const dv = take(/var (\w+)=\[\{n:"List",d:"/, "the below list");
  const card = take(/function (\w+)\((\w+),(\w+),(\w+)\)\{return\s*'<div class="card'\+\(\4\?" flipped":""\)/, "cardHtml");
  const guard = take(/function (\w+)\((\w+)\)\{try\{return \2\(\)\}catch(?:\(\w+\))?\{return""\}\}/, "guard");
  const render = take(/function (\w+)\((\w+)\)\{(\w+)\(\2\);var (\w+)=\2\.design,(\w+)=\4\.face-1,(\w+)=\2\.palette\?(\w+)\(\2\.palette\):(\w+)\[\5\]\.p\[\4\.colour\],(\w+)=(\w+)==="thumb",(\w+)=(?:\(PGV=\w+\(\w+\),(?:PGL=\w+\.locale==="ar",)?)?(\w+)\(\4\.below-1,!!\4\.brand_colors\)/, "renderPage");
  const tint = take(/function (\w+)\((\w+)\)\{return \2\.replace\(\/<a\\b/, "the brand tint");
  const pvars = take(/'" style="'\+(\w+)\((\w+)\)\+'"><div class="ov">/, "pvars");
  return {
    CT: tab[5], SO: tab[6], WE: tab[7], LIVE: live[2], LV: lv[1], ITEMS: lv[4], LA: la[1], IH: ih[1], pic: pic[1], PHOTO: pic[2], P: pic[3], MODE: mode[1],
    OPS: ops[1], DV: dv[1], card: card[1], guard: guard[1], pvars: pvars[1], tint: tint[1],
    render: { fn: render[1], inp: render[2], design: render[4], face: render[5], pi: render[6], thumb: render[9], below: render[11], belowFn: render[12] },
  };
}

function patchEngine(engine) {
  let out = engine.replace(MARK_RE, "");
  const n = names(out);
  // P.bio and P.cover, next to the other person fields
  if (!/,bio:\w+\(\w+\.bio\|\|""\)/.test(out)) {
    const cover = /(\w+)=(\w+)\.coverUrl\?(\w+)\((\w+)\(\2\.coverUrl\)\):""/.exec(out);
    must(cover, "engine.js: the cover line was not found");
    const lit = new RegExp(`${n.P}=\\{name:${cover[3]}\\(${cover[2]}\\.name\\),first:`).exec(out);
    must(lit, "engine.js: the person literal was not found");
    let depth = 0;
    let end = -1;
    for (let k = lit.index + n.P.length + 1; k < out.length; k++) {
      const ch = out[k];
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        end = k;
        break;
      }
    }
    must(end > 0, "engine.js: the person literal never closes");
    out = `${out.slice(0, end)},bio:${cover[3]}(${cover[2]}.bio||""),cover:${cover[2]}.coverUrl?${cover[3]}(${cover[4]}(${cover[2]}.coverUrl)):""${out.slice(end)}`;
  }
  // renderPage: the header instead of the face card, no flip hint, and the card colours kept for the layout below
  const r = n.render;
  if (!out.includes("PGTOP(")) {
    const call = `${n.card}(${r.face},${r.pi},!!${r.inp}.flipped)+"</div>"+(${r.thumb}?"":'<div class="hint">Tap the card to flip it</div>')`;
    must(out.includes(call), "engine.js: the card call in renderPage was not found");
    out = out.replace(call, `(${r.design}.top>0?PGTOP(${r.design}.top-1,${r.inp},${r.face},${r.pi},!!${r.inp}.flipped):${n.card}(${r.face},${r.pi},!!${r.inp}.flipped))+"</div>"+(${r.thumb}||${r.design}.top>0?"":'<div class="hint">Tap the card to flip it</div>')`);
    const below = `${r.below}=${r.belowFn}(${r.design}.below-1,!!${r.design}.brand_colors)`;
    must(out.includes(below), "engine.js: the below call in renderPage was not found");
    out = out.replace(below, `${r.below}=(PGV=${n.pvars}(${r.pi}),${r.belowFn}(${r.design}.below-1,!!${r.design}.brand_colors))`);
  }
  if (!/ as TOP_COUNT/.test(out)) {
    const exported = /export\{([^}]*)\}/.exec(out);
    must(exported, "engine.js: export list not found");
    out = out.replace(exported[0], `export{${exported[1]},PGTC as TOP_COUNT}`);
  }
  if (!out.includes("PGL=")) {
    const pv = `PGV=${n.pvars}(${r.pi}),`;
    must(out.includes(pv), "engine.js: the page variables call was not found");
    out = out.replace(pv, `${pv}PGL=${r.inp}.locale==="ar",`);
  }
  const block = `${MARK_START}import PAGES from"./pages.js";var PGV="",PGL=false;`
    + `function PGC(){return{P:${n.P},LIVE:${n.LIVE},CT:${n.CT},SO:${n.SO},WE:${n.WE},ITEMS:${n.ITEMS},LV:${n.LV},LA:${n.LA},IH:${n.IH},pic:${n.pic},thumb:${n.MODE}==="thumb",vars:PGV,face:"",ar:PGL}}`
    + `function PGTOP(k,i,e,r,fl){var t=PAGES.top[k];if(!t)return"";var c=PGC();c.vars=${n.pvars}(r);if(t.b&&(i.custom||i.design.photo))c.face='<div class="pg-fc">'+${n.card}(e,r,fl)+"</div>";var h=${n.guard}(function(){return t.h(c)});return i.design.brand_colors?${n.tint}(h):h}`
    + `PAGES.below.forEach(function(f){${n.DV}.push({n:f.n,d:f.d,h:function(){return f.h(PGC())}})});${JSON.stringify(PAGE_INTROS)}.forEach(function(o){${n.OPS}.push(o)});var PGTC=PAGES.top.length;${MARK_END}`;
  const pack2At = out.indexOf("/* pack2 start */");
  const countAt = /var \w+=\w+\.length,\w+=\w+\.length,\w+=\w+\.length;export\{/.exec(out);
  must(countAt, "engine.js: the line that counts the faces, layouts and openings was not found");
  const at = pack2At >= 0 ? pack2At : countAt.index;
  return out.slice(0, at) + block + out.slice(at);
}

function patchEngineDts(dts) {
  return dts.includes("TOP_COUNT") ? dts : dts.replace("export const BELOW_COUNT: number;\n", "export const BELOW_COUNT: number;\nexport const TOP_COUNT: number;\n");
}

// ---- meta.ts: BELOW_META grows to 427 entries, TOP_META is added, CSS_URL gets the new hash

function patchMeta(meta, cssVersion, pagesVersion) {
  const clean = meta.replace(/\/\* pages start[^\n]*\n/g, "").replace(/\/\* pages end \*\/\n/g, "").replace(/^export interface TopMeta .*\n/m, "").replace(/^export const TOP_META: TopMeta\[\] = .*\n/m, "").replace(/^\/\*\* The stylesheet of the page styles.*\n/m, "").replace(/^export const PAGES_CSS_URL = .*\n/m, "");
  const line = /^export const BELOW_META: \{ n: string; d: string \}\[\] = (\[.*\]);\n/m.exec(clean);
  must(line, "meta.ts: BELOW_META not found");
  const base = JSON.parse(line[1]);
  must(base.length >= PACK1_BELOW_COUNT, `meta.ts: expected at least ${PACK1_BELOW_COUNT} layouts, found ${base.length}`);
  const all = [...base.slice(0, PACK1_BELOW_COUNT), ...built.map((b) => ({ n: `${b.name} buttons`, d: `The buttons of the ${b.name} page, under its header.` }))];
  const tops = built.map((b) => ({ n: b.name, s: b.style, d: topDesc(b), b: b.blinq, rtl: b.rtl, ...(LAB_NAMES[b.top] ? { a: [LAB_NAMES[b.top].ar, LAB_NAMES[b.top].da] } : {}) }));
  const next = `${MARK_START.replace(" */", `: layouts ${PACK1_BELOW_COUNT + 1} to ${PACK1_BELOW_COUNT + TOP_COUNT} and TOP_META are added by scripts/build-pages.mjs */`)}\n`
    + `/** The stylesheet of the page styles; a card loads it only when it uses one. */\n`
    + `export const PAGES_CSS_URL = "/card-library/pages.css?v=${pagesVersion}";\n`
    + `export const BELOW_META: { n: string; d: string }[] = ${j(all)};\n`
    + `export interface TopMeta { n: string; s: string; d: string; b: boolean; rtl: boolean; a?: [string, string] }\n`
    + `export const TOP_META: TopMeta[] = ${j(tops)};\n${MARK_END}\n`;
  let out = clean.slice(0, line.index) + next + clean.slice(line.index + line[0].length);
  const introLine = /^export const INTRO_META: \[string, string\]\[\] = (\[.*\]);\n/m.exec(out);
  must(introLine, "meta.ts: INTRO_META not found");
  const intros = JSON.parse(introLine[1]).slice(0, PACK1_INTRO_COUNT);
  must(intros.length === PACK1_INTRO_COUNT, `meta.ts: expected ${PACK1_INTRO_COUNT} openings, found ${intros.length}`);
  out = out.slice(0, introLine.index) + `export const INTRO_META: [string, string][] = ${j([...intros, ...PAGE_INTROS])};\n` + out.slice(introLine.index + introLine[0].length);
  const url = /^export const CSS_URL = "\/card-library\/designs\.css\?v=[0-9a-f]+";$/m;
  must(url.test(out), "meta.ts: CSS_URL not found");
  return out.replace(url, `export const CSS_URL = "/card-library/designs.css?v=${cssVersion}";`);
}

// ---- designs.css: the pages' rules in a marked block in front of the Design Pack 2 block (or at the end)

/** designs.css keeps no rule of the page styles: an earlier run's block is taken out. */
function patchCss(css) {
  return `${css.replace(MARK_RE, "").replace(/\n+$/, "")}\n`;
}
/** pages.css: the rules of every page style (scoped under .cfl .pg-tN), minified. */
const pagesCss = () => `${esbuild.transformSync(cssParts.join("\n"), { loader: "css", minify: true, legalComments: "none" }).code.trim()}\n`;

// ---- write

const read = (p) => norm(fs.readFileSync(p, "utf8"));
const target = (dir, name) => path.join(OUT ?? dir, name);
if (OUT) fs.mkdirSync(OUT, { recursive: true });

const css = patchCss(read(path.join(PUBLIC, "designs.css")));
const version = crypto.createHash("sha1").update(css).digest("hex").slice(0, 8);
const pagesSheet = pagesCss();
const pagesVersion = crypto.createHash("sha1").update(pagesSheet).digest("hex").slice(0, 8);
const engine = patchEngine(read(path.join(GENERATED, "engine.js")));
const dts = patchEngineDts(read(path.join(GENERATED, "engine.d.ts")));
const meta = patchMeta(read(path.join(GENERATED, "meta.ts")), version, pagesVersion);

fs.writeFileSync(target(PUBLIC, "designs.css"), css);
fs.writeFileSync(target(PUBLIC, "pages.css"), pagesSheet);
fs.writeFileSync(target(GENERATED, "engine.js"), engine);
fs.writeFileSync(target(GENERATED, "engine.d.ts"), dts);
fs.writeFileSync(target(GENERATED, "meta.ts"), meta);
fs.writeFileSync(target(GENERATED, "pages.js"), header + pagesMin);
fs.writeFileSync(target(GENERATED, "pages.d.ts"), pagesDts);

console.log(`pages: ${built.length} headers and layouts ${PACK1_BELOW_COUNT + 1}-${PACK1_BELOW_COUNT + built.length}, pages.js ${Math.round(pagesMin.length / 1024)} KB, designs.css ${Math.round(css.length / 1024)} KB (v${version})${OUT ? `, written to ${OUT}` : ""}`);
console.log(`fonts the pages name: ${fontsUsed.join(", ")}`);
