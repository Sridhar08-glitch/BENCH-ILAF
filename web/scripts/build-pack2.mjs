// Adds Design Pack 2 (card faces 401 to 500) to the generated design library.
//
//   node scripts/build-pack2.mjs            (or npm run build:pack2)
//
// Reads the designers' files scripts/pack2/cards_*.html. Each face is one
//   <section class="card" data-no="401" data-name="…" data-family="…" data-fonts="…" data-rtl="0|1">
//     <style>/* rules scoped under .k401 */</style>
//     <div class="face k401" style="--ff:…">…markup with {name} {first} {last} {ini} {title} {co} {phone} {email} {site}…</div>
//   </section>
//
// Writes (every write replaces what an earlier run left, so running it again gives the same bytes):
//   src/lib/library/generated/pack2.js (+ .d.ts)  the 100 faces in the shape of the engine's face list: n, tags, p and
//                                                 h(person), a function that fills the markup from the engine's person
//   src/lib/library/generated/engine.js           one marked block that pushes the pack onto the engine's face list
//   src/lib/library/generated/meta.ts             FACE_META grows to 500 entries, CSS_URL gets the new stylesheet hash
//   public/card-library/designs.css               the faces' rules, scoped under .cfl .d401 … .d500, in a marked block
//
// How a designer face becomes an engine face:
//   - the root <div class="face k401"> is replaced by the engine's own face element; its inner markup is wrapped in
//     <div class="p2"> (filling the face) that carries the root's --ff style and dir="rtl";
//   - every class the designers used is renamed to p2-<class> in markup and rules, so no face rule can meet a rule of the
//     library (.ln, .dot, .bar …) or of the app; the elements that hold the name, title, company and contact placeholders
//     get the library's marker classes (n, t2, co, cl) so the text size and font settings and the long-name fitting work;
//   - the designers' Arabic sample person (name, title, company, initial) stands for the card's own details and becomes
//     the matching placeholders;
//   - the colourways (p) and the tags come from the face's family (FAMILIES below), the light colourway first.
//
// Set PACK2_OUT_DIR to write the five outputs to another folder instead (used by the determinism test).
// After a full `npm run build:library` the pack must be added again with this script.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import * as esbuild from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(WEB, "scripts", "pack2");
const GENERATED = path.join(WEB, "src", "lib", "library", "generated");
const PUBLIC = path.join(WEB, "public", "card-library");
const OUT = process.env.PACK2_OUT_DIR ? path.resolve(process.env.PACK2_OUT_DIR) : null;

export const PACK1_COUNT = 400;
const FIRST = 401;
const LAST = 500;
const ROOT = ".cfl";
/** The wrapper every pack face gets inside the engine's face element. */
const WRAP = "p2";
/** Prefix of every designer class after the rename. */
const PREFIX = "p2-";

/** Family -> [tags, four colourway indexes into PALETTES (light first)]. */
const FAMILIES = {
  Materials: [["luxury", "creative"], [1, 19, 5, 17]],
  Heritage: [["luxury", "creative"], [1, 14, 2, 5]],
  Typographic: [["bold", "creative"], [4, 7, 8, 16]],
  Geometric: [["creative", "bold"], [4, 0, 20, 12]],
  Tech: [["tech", "bold"], [16, 23, 21, 15]],
  Nature: [["creative", "minimal"], [18, 2, 11, 17]],
  Industry: [["corporate"], [9, 5, 2, 7]],
  Playful: [["playful"], [22, 8, 10, 3]],
  Luxury: [["luxury", "minimal"], [1, 19, 5, 14]],
  Minimal: [["minimal"], [4, 1, 16, 19]],
  Bilingual: [["corporate", "minimal"], [1, 5, 9, 0]],
  Qatar: [["luxury", "corporate"], [1, 14, 4, 5]],
};

/** Placeholder -> field of the engine's person (already HTML-escaped by the engine). */
const FIELDS = { name: "name", first: "first", last: "last", ini: "ini", title: "title", co: "company", phone: "phone", email: "email", site: "web" };
/** Placeholder -> the library's marker class for that kind of text (one per element, in this order of preference). */
const MARKERS = [["name", "n"], ["first", "n"], ["last", "n"], ["title", "t2"], ["co", "co"], ["phone", "cl"], ["email", "cl"], ["site", "cl"]];
/** The designers' Arabic sample person, in the order the longer texts must be replaced. */
const ARABIC_SAMPLE = [["نورة الكواري", "{name}"], ["مستشارة أعمال", "{title}"], ["مجموعة الخليج", "{co}"], [">ن<", ">{ini}<"]];

const norm = (s) => s.replace(/\r\n/g, "\n");
const must = (cond, msg) => {
  if (!cond) throw new Error(`build-pack2: ${msg}`);
};

// ---- read and validate the designers' files

const files = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter((f) => /^cards_.*\.html$/.test(f)).sort() : [];
must(files.length > 0, `no cards_*.html in ${SRC}`);

const SECTION = /<section class="card"([^>]*)>([\s\S]*?)<\/section>/g;
const ATTR = /data-(\w+)="([^"]*)"/g;
const sections = new Map();
for (const file of files) {
  const text = norm(fs.readFileSync(path.join(SRC, file), "utf8"));
  for (const m of text.matchAll(SECTION)) {
    const a = Object.fromEntries([...m[1].matchAll(ATTR)].map((x) => [x[1], x[2]]));
    const no = Number(a.no);
    must(Number.isInteger(no) && no >= FIRST && no <= LAST, `${file}: face number ${a.no} is outside ${FIRST}-${LAST}`);
    if (sections.has(no)) throw new Error(`build-pack2: face ${no} appears twice (${sections.get(no).file} and ${file})`);
    must(a.name && a.name.trim(), `face ${no}: no data-name`);
    must(FAMILIES[a.family], `face ${no}: unknown family "${a.family}" (known: ${Object.keys(FAMILIES).join(", ")})`);
    sections.set(no, { file, no, name: a.name.trim(), family: a.family, fonts: a.fonts || "", rtl: a.rtl === "1", body: m[2] });
  }
}
must(sections.size === LAST - FIRST + 1, `expected ${LAST - FIRST + 1} faces, found ${sections.size}`);

const BAD_MARKUP = [/<script/i, /<style/i, /<link/i, /<iframe/i, /<object/i, /<embed/i, /\son\w+\s*=/i, /javascript:/i, /url\((['"]?)\s*https?:/i, /@import/i];

function splitFace(s) {
  const styleStart = s.body.indexOf("<style>");
  const styleEnd = s.body.indexOf("</style>");
  must(styleStart >= 0 && styleEnd > styleStart, `face ${s.no}: no <style> block`);
  const css = s.body.slice(styleStart + 7, styleEnd);
  const markup = s.body.slice(styleEnd + 8).trim();
  const open = new RegExp(`^<div class="face k${s.no}"([^>]*)>`).exec(markup);
  must(open, `face ${s.no}: the markup must start with <div class="face k${s.no}">`);
  must(markup.endsWith("</div>"), `face ${s.no}: the markup must end with the root's </div>`);
  const inner = markup.slice(open[0].length, markup.length - 6);
  for (const re of BAD_MARKUP) must(!re.test(inner) && !re.test(css), `face ${s.no}: not allowed in a face: ${re}`);
  const rootAttrs = open[1];
  const ff = /style="--ff:([^"]*)"/.exec(rootAttrs)?.[1] ?? "";
  const rest = rootAttrs.replace(/\s*style="--ff:[^"]*"/, "").replace(/\s*dir="rtl"/, "").trim();
  must(rest === "", `face ${s.no}: the root may only carry style="--ff:…" and dir="rtl", not ${rest}`);
  const rtl = s.rtl || /dir="rtl"/.test(rootAttrs);
  return { css, inner, ff, rtl };
}

// ---- markup: the sample person, class names, marker classes, the template function

function withPlaceholders(inner) {
  let out = inner;
  for (const [from, to] of ARABIC_SAMPLE) out = out.split(from).join(to);
  return out;
}

const CLASS_ATTR = /\sclass=("([^"]*)"|'([^']*)')/g;
const CLASS_NAME = /^[a-zA-Z][\w-]*$/;

function renameClasses(inner, no) {
  return inner.replace(CLASS_ATTR, (whole, quoted, dq, sq) => {
    const names = (dq ?? sq).trim().split(/\s+/).filter(Boolean);
    for (const c of names) {
      must(CLASS_NAME.test(c), `face ${no}: odd class name "${c}"`);
      must(!c.startsWith(PREFIX), `face ${no}: class names may not start with ${PREFIX}`);
    }
    return ` class="${names.map((c) => PREFIX + c).join(" ")}"`;
  });
}

const VOID = new Set(["br", "img", "input", "hr", "wbr", "source", "col", "area", "base", "meta", "param", "track"]);
const PLACEHOLDER = /\{(\w+)\}/g;

/** Give the innermost element around each placeholder the library's marker class for that kind of text. */
function addMarkers(inner, no) {
  const TAG = /<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g;
  const stack = [];
  const marks = new Map(); // start index of an opening tag -> marker class
  let last = 0;
  const markText = (text) => {
    const found = [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);
    for (const f of found) must(f in FIELDS, `face ${no}: unknown placeholder {${f}}`);
    if (!found.length || !stack.length) return;
    const top = stack[stack.length - 1];
    if (marks.has(top.start)) return;
    const pick = MARKERS.find(([key]) => found.includes(key));
    if (pick) marks.set(top.start, pick[1]);
  };
  for (const m of inner.matchAll(TAG)) {
    markText(inner.slice(last, m.index));
    last = m.index + m[0].length;
    const [, closing, name, attrs] = m;
    if (closing) {
      while (stack.length && stack[stack.length - 1].name !== name.toLowerCase()) stack.pop();
      stack.pop();
    } else if (!VOID.has(name.toLowerCase()) && !attrs.trimEnd().endsWith("/")) {
      stack.push({ name: name.toLowerCase(), start: m.index, end: last });
    }
  }
  markText(inner.slice(last));
  // rewrite the marked opening tags, from the end so the indexes stay valid
  let out = inner;
  for (const [start, marker] of [...marks].sort((a, b) => b[0] - a[0])) {
    const end = out.indexOf(">", start);
    const tag = out.slice(start, end);
    const next = /\sclass="([^"]*)"/.test(tag) ? tag.replace(/\sclass="([^"]*)"/, (w, c) => ` class="${c} ${marker}"`) : `${tag} class="${marker}"`;
    out = out.slice(0, start) + next + out.slice(end);
  }
  return out;
}

/** The body of h(p): a string expression that builds the face's inner markup from the person p. */
function templateSource(inner, ff, rtl, no) {
  const all = `<div class="${WRAP}"${rtl ? ' dir="rtl"' : ""}${ff ? ` style="--ff:${ff.replace(/"/g, "&quot;")}"` : ""}>${inner}</div>`;
  const parts = [];
  let last = 0;
  for (const m of all.matchAll(PLACEHOLDER)) {
    must(m[1] in FIELDS, `face ${no}: unknown placeholder {${m[1]}}`);
    if (m.index > last) parts.push(JSON.stringify(all.slice(last, m.index)));
    parts.push(`p.${FIELDS[m[1]]}`);
    last = m.index + m[0].length;
  }
  if (last < all.length) parts.push(JSON.stringify(all.slice(last)));
  return parts.join("+") || '""';
}

/** The ids of a face's inline SVG (gradients, masks, clips) are made unique to the face, in the markup and in the rules that point at them. */
function uniqueIds(inner, css, no) {
  const ids = [...inner.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
  for (const id of ids) must(CLASS_NAME.test(id), `face ${no}: odd id "${id}"`);
  must(new Set(ids).size === ids.length, `face ${no}: an id is used twice`);
  const fresh = (id) => `${WRAP}-${no}-${id}`;
  let markup = inner;
  let rules = css;
  for (const id of ids) {
    const ref = new RegExp(`(url\\(#|href="#)${id}(?=[)"])`, "g");
    markup = markup.replace(new RegExp(`(\\sid=")${id}(?=")`, "g"), `$1${fresh(id)}`).replace(ref, `$1${fresh(id)}`);
    rules = rules.replace(ref, `$1${fresh(id)}`);
  }
  return [markup, rules];
}

// ---- rules: scoped under .cfl .dNNN .p2, designer classes renamed, nothing else allowed

function scopeCss(css, no) {
  const tree = postcss.parse(css);
  const root = `.k${no}`;
  const rootRe = new RegExp(`\\.k${no}(?![\\w-])`, "g");
  tree.walkAtRules((at) => {
    if (/^keyframes$/i.test(at.name)) {
      must(at.params.trim().startsWith(`k${no}`), `face ${no}: @keyframes "${at.params}" must be named k${no}…`);
      return;
    }
    throw new Error(`build-pack2: face ${no}: @${at.name} is not allowed in a face`);
  });
  tree.walkDecls((d) => {
    must(!/url\((['"]?)\s*(https?:|\/\/)/i.test(d.value), `face ${no}: a rule loads something from the web: ${d.prop}`);
  });
  tree.walkRules((rule) => {
    if (rule.parent && rule.parent.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    rule.selectors = rule.selectors.map((sel) => {
      const s = sel.trim();
      must(rootRe.test(s) && s.startsWith(root), `face ${no}: selector not scoped under ${root}: ${s}`);
      rootRe.lastIndex = 0;
      // the root token aside, every class is a designer class and gets the prefix
      const renamed = s.replace(rootRe, "\u0000").replace(/\.(-?[_a-zA-Z][\w-]*)/g, (w, c) => `.${PREFIX}${c}`);
      return renamed.replace(/\u0000/g, (x, i) => (i === 0 ? `${ROOT} .d${no} .${WRAP}` : `.${WRAP}`));
    });
  });
  return tree.toString();
}

// ---- build every face

const faces = [];
const cssParts = [`${ROOT} .face .${WRAP}{position:absolute;inset:0}`];
const fontsUsed = new Set();
for (const no of [...sections.keys()].sort((a, b) => a - b)) {
  const s = sections.get(no);
  const { css, inner, ff, rtl } = splitFace(s);
  const [tags, p] = FAMILIES[s.family];
  const [markupIds, cssIds] = uniqueIds(inner, css, no);
  const markup = addMarkers(renameClasses(withPlaceholders(markupIds), no), no);
  // the sample person is the only Arabic text a face may carry; the card's own details fill the placeholders
  must(!/[؀-ۿ]/.test(markup), `face ${no}: Arabic sample text left in the markup (only the sample person of the brief is known)`);
  for (const f of s.fonts.split(",").map((x) => x.trim()).filter(Boolean)) fontsUsed.add(f);
  faces.push({ no, name: s.name, tags, p, h: templateSource(markup, ff, rtl, no) });
  cssParts.push(scopeCss(cssIds, no));
}

// ---- pack2.js and pack2.d.ts

const j = (v) => JSON.stringify(v);
const packSource = `var PACK2=[${faces.map((f) => `{n:${j(f.name)},tags:${j(f.tags)},p:${j(f.p)},h:function(p){return ${f.h}}}`).join(",\n")}];\nexport default PACK2;\n`;
const packMin = esbuild.transformSync(packSource, { minify: true, format: "esm", target: "es2019", legalComments: "none" }).code;
const packHeader = "// Generated by scripts/build-pack2.mjs from scripts/pack2/cards_*.html. Do not edit.\n";
const packDts = `${packHeader}/** A face of Design Pack 2: name, tags, four colourway indexes into PALETTES and the markup inside the face for a person. */
export interface Pack2Face { n: string; tags: string[]; p: number[]; h: (person: Record<string, string>) => string }
declare const PACK2: Pack2Face[];
export default PACK2;
`;

// ---- engine.js: one marked block that pushes the pack onto the face list before FACE_COUNT is taken

const MARK_START = "/* pack2 start */";
const MARK_END = "/* pack2 end */";
const MARK_RE = /\/\* pack2 start \*\/[\s\S]*?\/\* pack2 end \*\/\n?/g;

function patchEngine(engine) {
  const clean = engine.replace(MARK_RE, "");
  if (/from\s*["']\.\/pack2\.js["']/.test(clean)) {
    console.log("engine.js already imports the pack (a full rebuild carried the hook); its face list is left alone");
    return clean;
  }
  const exported = /export\{([^}]*)\}/.exec(clean);
  must(exported, "engine.js: export list not found");
  const countVar = /(\w+) as FACE_COUNT/.exec(exported[1])?.[1];
  must(countVar, "engine.js: FACE_COUNT export not found");
  const lengthRe = new RegExp(`var ${countVar}=(\\w+)\\.length`);
  const lengthAt = lengthRe.exec(clean);
  must(lengthAt, "engine.js: the line that counts the faces was not found");
  const facesVar = lengthAt[1];
  const personVar = /(\w+)=\{name:\w+\(\w+\.name\),first:\w+\(\w+\.first\)/.exec(clean)?.[1];
  must(personVar, "engine.js: the person variable was not found");
  const block = `${MARK_START}import PACK2 from"./pack2.js";PACK2.forEach(function(f){${facesVar}.push({n:f.n,tags:f.tags,p:f.p,h:function(){return f.h(${personVar})}})});${MARK_END}`;
  return clean.slice(0, lengthAt.index) + block + clean.slice(lengthAt.index);
}

// ---- meta.ts: FACE_META grows to 500 entries (a plain JSON literal, read by the backend's wallet colour script too)

function patchMeta(meta, cssVersion) {
  const clean = meta.replace(/\/\* pack2 start[^\n]*\n/g, "").replace(/\/\* pack2 end \*\/\n/g, "");
  const line = /^export const FACE_META: FaceMeta\[\] = (\[.*\]);$/m.exec(clean);
  must(line, "meta.ts: FACE_META not found");
  const base = JSON.parse(line[1]);
  must(base.length >= PACK1_COUNT, `meta.ts: expected at least ${PACK1_COUNT} faces, found ${base.length}`);
  const all = [...base.slice(0, PACK1_COUNT), ...faces.map((f) => ({ n: f.name, tags: f.tags, p: f.p }))];
  const next = `${MARK_START.replace(" */", `: faces ${FIRST} to ${LAST} are added to FACE_META by scripts/build-pack2.mjs */`)}\nexport const FACE_META: FaceMeta[] = ${j(all)};\n${MARK_END}`;
  const out = clean.slice(0, line.index) + next + clean.slice(line.index + line[0].length);
  const url = /^export const CSS_URL = "\/card-library\/designs\.css\?v=[0-9a-f]+";$/m;
  must(url.test(out), "meta.ts: CSS_URL not found");
  return out.replace(url, `export const CSS_URL = "/card-library/designs.css?v=${cssVersion}";`);
}

// ---- designs.css: the pack's rules in a marked block at the end, and the version hash of the whole sheet

function patchCss(css) {
  const clean = css.replace(MARK_RE, "").replace(/\n+$/, "");
  const packCss = esbuild.transformSync(cssParts.join("\n"), { loader: "css", minify: true, legalComments: "none" }).code.trim();
  return `${clean}\n${MARK_START}${packCss}${MARK_END}\n`;
}

// ---- write

const read = (p) => norm(fs.readFileSync(p, "utf8"));
const target = (dir, name) => path.join(OUT ?? dir, name);
if (OUT) fs.mkdirSync(OUT, { recursive: true });

const css = patchCss(read(path.join(PUBLIC, "designs.css")));
const version = crypto.createHash("sha1").update(css).digest("hex").slice(0, 8);
const engine = patchEngine(read(path.join(GENERATED, "engine.js")));
const meta = patchMeta(read(path.join(GENERATED, "meta.ts")), version);

fs.writeFileSync(target(PUBLIC, "designs.css"), css);
fs.writeFileSync(target(GENERATED, "engine.js"), engine);
fs.writeFileSync(target(GENERATED, "meta.ts"), meta);
fs.writeFileSync(target(GENERATED, "pack2.js"), packHeader + packMin);
fs.writeFileSync(target(GENERATED, "pack2.d.ts"), packDts);

console.log(`pack2: ${faces.length} faces (${FIRST}-${LAST}), pack2.js ${Math.round(packMin.length / 1024)} KB, designs.css ${Math.round(css.length / 1024)} KB (v${version})${OUT ? `, written to ${OUT}` : ""}`);
console.log(`fonts the designers named: ${[...fontsUsed].sort().join(", ")}`);
