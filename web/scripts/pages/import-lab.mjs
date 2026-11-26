// One-off tool that turns the 50 standalone design prototypes (design-lab/batch1..5) into page sources for build-pages:
//   node scripts/pages/import-lab.mjs [--only=03,07] [--force]
// Writes scripts/pages/lab/NN-slug.html, one file per design: a recipe comment, the scoped CSS (px turned into cqw so the page
// scales with its container) and the markup with the sample person replaced by placeholders. The files are the source of truth
// afterwards (edit them by hand); this tool never overwrites an existing file unless --force is given.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LAB = path.resolve(WEB, "..", "design-lab");
const OUT = path.join(WEB, "scripts", "pages", "lab");
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1]?.split(",") || null;
const force = process.argv.includes("--force");
const W = 390;

const GROUPS = { 1: "Editorial", 2: "Objects", 3: "Digital", 4: "Gulf", 5: "Creative" };
const NAMES = {
  "01": "Magazine cover", "02": "Front page", "03": "Swiss grid", "04": "Poster type", "05": "Bauhaus", "06": "Art deco", "07": "Notebook", "08": "Blueprint", "09": "Letterpress", "10": "Brutalist",
  "11": "Boarding pass", "12": "Polaroid", "13": "Vinyl sleeve", "14": "Passport", "15": "Event badge", "16": "Receipt", "17": "Wine label", "18": "Luggage tag", "19": "Film contact sheet", "20": "Playing card",
  "21": "Glass aurora", "22": "Neon night", "23": "Terminal", "24": "Soft clay", "25": "Gradient orbs", "26": "Dark gold foil", "27": "Synthwave", "28": "Y2K chrome", "29": "Now playing", "30": "Paper layers",
  "31": "Girih geometry", "32": "Dunes", "33": "Sadu weave", "34": "Calligraphy name", "35": "Pearl and sea", "36": "Zellige tiles", "37": "Skyline dusk", "38": "Carved door", "39": "Mihrab arch", "40": "Souq sign",
  "41": "Cinematic hero", "42": "Split diagonal", "43": "Watercolor", "44": "Topographic", "45": "Ma minimal", "46": "Memphis pop", "47": "Monogram pattern", "48": "Sticker sheet", "49": "Career timeline", "50": "Matchbook",
};

// ---- tiny DOM (same tolerance as build-pages)
const VOID = new Set(["br", "img", "input", "hr", "wbr", "source", "col", "area", "base", "meta", "param", "track"]);
const ATTRS = /([^\s"'=<>/]+)(?:\s*=\s*"([^"]*)")?/g;
const el = (tag, attrs = [], children = []) => ({ type: "el", tag, attrs, children });
function parse(html) {
  const root = el("#root");
  const stack = [root];
  const TAG = /<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g;
  let last = 0;
  let m;
  while ((m = TAG.exec(html))) {
    if (m.index > last) stack.at(-1).children.push({ type: "text", text: html.slice(last, m.index) });
    last = m.index + m[0].length;
    const [, closing, name, rawAttrs] = m;
    if (closing) {
      while (stack.length > 1 && stack.at(-1).tag !== name) stack.pop();
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = [...rawAttrs.matchAll(ATTRS)].filter((x) => x[1] !== "/").map((x) => [x[1], x[2] ?? null]);
    const node = el(name, attrs);
    stack.at(-1).children.push(node);
    if (name === "svg") {
      const end = html.indexOf("</svg>", last);
      node.children.push({ type: "raw", text: html.slice(last, end) });
      last = end + 6;
      TAG.lastIndex = last;
      continue;
    }
    if (!VOID.has(name) && !rawAttrs.trim().endsWith("/")) stack.push(node);
  }
  if (last < html.length) root.children.push({ type: "text", text: html.slice(last) });
  return root;
}
const ser = (n) => {
  if (n.type === "text" || n.type === "raw") return n.text;
  if (n.tag === "#root") return n.children.map(ser).join("");
  const a = n.attrs.map(([k, v]) => (v === null ? ` ${k}` : ` ${k}="${v}"`)).join("");
  return VOID.has(n.tag) ? `<${n.tag}${a}>` : `<${n.tag}${a}>${n.children.map(ser).join("")}</${n.tag}>`;
};
const attr = (n, k) => (n.attrs.find((a) => a[0] === k) || [])[1];
const classes = (n) => (attr(n, "class") || "").split(/\s+/).filter(Boolean);
const setAttr = (n, k, v) => {
  const i = n.attrs.findIndex((a) => a[0] === k);
  if (v === null) {
    if (i >= 0) n.attrs.splice(i, 1);
  } else if (i >= 0) n.attrs[i][1] = v;
  else n.attrs.push([k, v]);
};
const kids = (n) => n.children.filter((c) => c.type === "el");
function walk(n, fn) {
  if (n.type !== "el" && n.tag !== "#root") return;
  fn(n);
  for (const c of n.children || []) if (c.type === "el") walk(c, fn);
}
const textOf = (n) => (n.type === "text" ? n.text : n.type === "el" && n.tag !== "svg" ? n.children.map(textOf).join("") : "");

// ---- CSS: px -> cqw, scoped under .pN, root/body/sheet rules moved onto .in
const RENAME = { top: "x-top", in: "x-in", bt: "x-bt", ph: "x-ph", fc: "x-fc", pic: "x-pic" };
const cqw = (px) => `${+((px * 100) / W).toFixed(3)}cqw`;
function convertValue(prop, value) {
  if (/^(--[\w-]+)$/.test(prop) === false && /^(src|content)$/.test(prop)) return value;
  // keep data: urls untouched
  const parts = value.split(/(url\([^)]*\))/);
  return parts.map((part) => {
    if (part.startsWith("url(")) return part;
    let v = part.replace(/(-?\d*\.?\d+)vw\b/g, "$1cqw").replace(/(-?\d*\.?\d+)px\b/g, (m, n) => {
      const x = parseFloat(n);
      if (Math.abs(x) <= 2 && !/^(font-size|width|height|gap|margin|padding|inset|top|left|right|bottom)/.test(prop) && !prop.startsWith("--")) return m;
      return cqw(x);
    });
    return v;
  }).join("");
}
function floorFont(value) {
  const m = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  return m && parseFloat(m[1]) < 13 ? `max(10px,${cqw(parseFloat(m[1]))})` : null;
}
function convertCss(css, no, sheetSel) {
  const tree = postcss.parse(css);
  const P = `.p${no}`;
  tree.walkAtRules((at) => {
    if (/^keyframes$/i.test(at.name)) return;
    if (/^media$/i.test(at.name) && /prefers-reduced-motion/.test(at.params)) return;
    at.remove();
  });
  tree.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    const out = [];
    let kind = null; // "body" | "root" | "sheet" when the whole rule styles the page itself
    for (const sel of rule.selectors.map((x) => x.trim())) {
      let s = sel;
      if (/^\*(::before|::after)?$/.test(s)) s = `${P} ${s}`;
      else if (s === ":root") (kind = "root"), (s = `${P} .in`);
      else if (/^(html|body|html\s+body)$/.test(s)) (kind = "body"), (s = `${P} .in`);
      else if (s === sheetSel) (kind = "sheet"), (s = `${P} .in`);
      else {
        s = s.replace(/^(html\s+)?body\s+/, "").replace(/^html\s+/, "");
        if (s.startsWith(sheetSel + " ") || s.startsWith(sheetSel + ">")) s = `.in${s.slice(sheetSel.length)}`;
        else if (s.startsWith(sheetSel) && /^[.:\[]/.test(s.slice(sheetSel.length)) && sheetSel.startsWith(".")) s = `.in${s.slice(sheetSel.length)}`;
        s = `${P} ${s}`.replace(/\.(top|ph|fc|pic|bt)(?![\w-])/g, (m, c) => "." + RENAME[c]);
        if (!/\.in(?![\w-])/.test(s.replace(`${P} `, "")) === false) { /* keeps .in of the sheet */ }
        s = s.replace(/^(\.p\d+ )(?!\.in(?![\w-]))(.*)$/, (m, pre, rest) => pre + rest.replace(/\.in(?![\w-])/g, ".x-in"));
        // the sheet's own ".in" produced above (not yet renamed) must stay: re-apply for selectors that began with the sheet
        if (sel.startsWith(sheetSel + " ") || sel.startsWith(sheetSel + ">")) s = s.replace(`${P} .x-in`, `${P} .in`);
      }
      out.push(s);
    }
    rule.selectors = [...new Set(out)];
    rule.walkDecls((d) => {
      if (kind === "body" && !/^(font-family|font-size|line-height|color|letter-spacing|font-feature-settings|font-variant-numeric)$/.test(d.prop) && !d.prop.startsWith("--")) return void d.remove();
      if (kind === "sheet" && /^(width|max-width|min-height|margin|margin-inline|margin-block|box-shadow|min-width)$/.test(d.prop)) return void d.remove();
      if (/(min-)?height$/.test(d.prop) && /\d(vh|dvh|svh)/.test(d.value)) return void d.remove();
      if (d.prop === "position" && /fixed|sticky/.test(d.value)) return void (d.value = "relative");
      const fl = d.prop === "font-size" ? floorFont(d.value) : null;
      d.value = fl || convertValue(d.prop, d.value);
    });
    if (rule.nodes && rule.nodes.length === 0) rule.remove();
  });
  return tree.toString();
}

// ---- text: the sample person becomes placeholders
const NAME_RE = /Noura(?:\s|&nbsp;)Al(?:-|‑|&#8209;|&#8209;)Kuwari/g;
const SUBS = [
  [NAME_RE, "{name}"],
  [/Noura Al<[^>]*>(?:&#8209;|-)<\/[^>]*>Kuwari/g, "{name}"],
  [/Business Consultant/gi, "{title}"],
  [/Gulf Group/gi, "{co}"],
  [/West Bay, Doha/g, "{city}"],
  [/Doha, Qatar/g, "{city}"],
  [/I help family businesses in the Gulf build lasting partnerships and clear growth plans\.?/g, "{bio}"],
  [/\+974(?: |&nbsp;)?5555(?: |&nbsp;)?0123/g, "{phone}"],
  [/noura@gulf-group\.qa/g, "{email}"],
  [/gulf-group\.qa/g, "{site}"],
  [/>\s*N\.?\s?K\.?\s*</g, ">{ini}<"],
];

function readBatchFiles() {
  const list = [];
  for (const b of [1, 2, 3, 4, 5]) {
    for (const f of fs.readdirSync(path.join(LAB, `batch${b}`)).filter((x) => x.endsWith(".html")).sort()) list.push({ batch: b, file: path.join(LAB, `batch${b}`, f), id: f.slice(0, 2), slug: f.replace(/\.html$/, "") });
  }
  return list;
}

function convertOne({ batch, file, id, slug }) {
  const n = Number(id);
  const top = 27 + n;
  const no = 100 + n;
  let html = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const rtlPage = /<html[^>]*dir="rtl"/.test(html);
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  let body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)[1].replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  // symbols of the shared icon sprite, inlined where they are used
  const symbols = {};
  body = body.replace(/<svg[^>]*(?:width="0"|display:none)[^>]*>[\s\S]*?<\/svg>/g, (blk) => {
    for (const m of blk.matchAll(/<symbol id="([\w-]+)"([^>]*)>([\s\S]*?)<\/symbol>/g)) symbols[m[1]] = { attrs: m[2], inner: m[3] };
    return "";
  });
  body = body.replace(/<svg([^>]*)>\s*<use\s+(?:xlink:)?href="#([\w-]+)"\s*\/?>\s*(?:<\/use>)?\s*<\/svg>/g, (m, a, id) => {
    const s = symbols[id];
    if (!s) return m;
    const vb = /viewBox="[^"]*"/.exec(s.attrs)?.[0] || 'viewBox="0 0 24 24"';
    return `<svg${/viewBox=/.test(a) ? a : `${a} ${vb}`}>${s.inner}</svg>`;
  });
  const root = parse(body.trim());
  const sheet = kids(root)[0];
  const sheetSel = sheet.tag === "main" && !classes(sheet).length ? "main" : classes(sheet).length ? `.${classes(sheet)[0]}` : sheet.tag;
  const sheetClasses = new Set(classes(sheet));
  const rootEl = sheet;

  // rename the classes that clash with the engine
  walk(rootEl, (x) => {
    const c = classes(x);
    if (c.some((k) => RENAME[k])) setAttr(x, "class", c.map((k) => RENAME[k] || k).join(" "));
  });
  const warnings = [];
  const drop = [];
  // the save anchor and the footer are the engine's job
  walk(rootEl, (x) => {
    if (x.tag === "a" && /^data:text\/vcard/.test(attr(x, "href") || "")) {
      const c = classes(x);
      if (c.length) drop.push(c[0]);
      else {
        setAttr(x, "class", "sv-gone");
        drop.push("sv-gone");
      }
    }
    if (x.tag === "footer") {
      const c = classes(x);
      if (c.length) drop.push(c[0]);
      else {
        setAttr(x, "class", "ft-gone");
        drop.push("ft-gone");
      }
    }
  });
  // links: the group of anchors that carry the owner's buttons
  const isLink = (a) => a.tag === "a" && /^(tel:|mailto:|https?:\/\/(wa\.me|www\.linkedin|gulf-group|maps\.google)|geo:|https:\/\/wa\.me)/.test(attr(a, "href") || "");
  const groups = new Map();
  walk(rootEl, (x) => {
    for (const c of x.children) if (c.type === "el" && isLink(c)) {
      const key = x;
      groups.set(key, [...(groups.get(key) || []), c]);
    }
  });
  const best = [...groups].sort((a, b) => b[1].length - a[1].length)[0];
  const lists = [];
  let split = null;
  if (best && best[1].length >= 4) {
    const [host, anchors] = best;
    const cls = classes(anchors[0]);
    if (cls.length && anchors.every((a) => classes(a)[0] === cls[0])) {
      const noText = anchors.every((a) => !textOf(a).trim());
      lists.push({ c: cls[0], role: noText ? "icons" : "tiles", items: "all" });
    } else if (classes(host).length) lists.push({ c: classes(host)[0], role: "tiles", items: "all" });
    else warnings.push("link group has no class");
    // the top-level child that holds the list
    let cur = host;
    const chain = [];
    const findPath = (n, target, acc) => {
      if (n === target) return acc;
      for (const c of n.children) if (c.type === "el") {
        const r = findPath(c, target, [...acc, c]);
        if (r) return r;
      }
      return null;
    };
    const p = findPath(rootEl, host, [rootEl]) || [];
    const child = p[1] || host;
    void cur;
    void chain;
    if (child !== host || true) {
      if (!classes(child).length) setAttr(child, "class", "lst");
      split = classes(child)[0];
    }
  } else warnings.push("no link group found");
  // avatar: an svg that is a portrait
  let avatar = null;
  walk(rootEl, (x) => {
    if (avatar || x.tag !== "svg") return;
    if (/portrait|avatar|photo|bust|monogram/i.test(attr(x, "aria-label") || "") || /portrait|avatar|photo|\bav\b/i.test(classes(x).join(" "))) avatar = x;
  });
  let avatarClass = null;
  if (avatar) {
    const par = (function find(n, t) { for (const c of n.children) if (c.type === "el") { if (c === t) return n; const r = find(c, t); if (r) return r; } return null; })(rootEl, avatar);
    if (par && par !== rootEl && classes(par).length) avatarClass = classes(par)[0];
    else {
      // wrap the svg
      const w = el("span", [["class", "avw"]], [avatar]);
      par.children.splice(par.children.indexOf(avatar), 1, w);
      avatarClass = "avw";
    }
  } else warnings.push("no portrait svg found");
  // remove hrefs that are not list items (they are sample links) and download attributes
  walk(rootEl, (x) => {
    if (x.tag === "a") {
      setAttr(x, "href", null);
      setAttr(x, "download", null);
      setAttr(x, "target", null);
      setAttr(x, "rel", null);
    }
  });
  let markup = rootEl.children.map(ser).join("");
  for (const [re, to] of SUBS) markup = markup.replace(re, to);
  markup = markup.replace(/>\s*Noura\s*</g, ">{first}<").replace(/>\s*Al(?:-|‑|&#8209;)Kuwari\s*</g, ">{last}<");
  let css = convertCss(style, no, sheetSel).trim();
  const left = [...markup.replace(/<svg[\s\S]*?<\/svg>/g, "").matchAll(/[^<>{}]*\b(?:Noura|Kuwari|Doha|Qatar|Gulf|\+974|West Bay)\b[^<>{}]*/g)].map((m) => m[0].trim());
  if (left.length) warnings.push(`sample text left: ${left.slice(0, 4).join(" | ")}`);
  const recipe = { top, style: GROUPS[batch], name: NAMES[id], slug, dir: rtlPage ? "rtl" : "ltr", split, avatar: avatarClass, drop, lists };
  const header = `<section class="page" data-no="${no}" data-name="${NAMES[id]}" data-style="${GROUPS[batch]}" data-rtl="${rtlPage ? 1 : 0}">\n<!--recipe ${JSON.stringify(recipe)}-->\n`;
  const text = `${header}<style>\n${css.replace(/\}\s*/g, "}\n")}\n</style>\n<div class="pg p${no}"><div class="in">\n${markup.trim()}\n</div></div>\n</section>\n`;
  return { text, warnings, recipe, sheetClasses: [...sheetClasses] };
}

fs.mkdirSync(OUT, { recursive: true });
for (const f of readBatchFiles()) {
  if (only && !only.includes(f.id)) continue;
  const target = path.join(OUT, `${f.slug}.html`);
  if (fs.existsSync(target) && !force) {
    console.log(`${f.id} exists, skipped`);
    continue;
  }
  const r = convertOne(f);
  fs.writeFileSync(target, r.text);
  console.log(`${f.id} ${f.slug}: split=${r.recipe.split} avatar=${r.recipe.avatar} lists=${JSON.stringify(r.recipe.lists)} ${r.warnings.length ? "WARN " + r.warnings.join("; ") : ""}`);
}
