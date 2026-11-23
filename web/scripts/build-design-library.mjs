// Builds the card design library (400 faces, 400 layouts below the card, 400 opening animations) from the
// pieces of the design page.
//
//   node scripts/build-design-library.mjs <folder with the design page pieces>
//   (or set DESIGN_SRC to that folder)
//
// Writes:
//   src/lib/library/generated/engine.js   (and engine.d.ts) the string renderer with the code of every face, layout and opening
//   src/lib/library/generated/meta.ts     names, tags, colourways, opening keys, fonts link, stylesheet version
//   public/card-library/designs.css       one stylesheet for everything, scoped under .cfl
// The output depends only on the input files, so running it twice gives the same bytes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import * as esbuild from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PARTS = path.join(WEB, "scripts", "design-library");
const SRC = process.argv[2] || process.env.DESIGN_SRC;
if (!SRC) {
  console.error("Give the folder with the design page pieces: node scripts/build-design-library.mjs <folder>");
  process.exit(1);
}

const norm = (s) => s.replace(/\r\n/g, "\n");
const read = (dir, name) => norm(fs.readFileSync(path.join(dir, name), "utf8"));
const src = (name) => read(SRC, name);
/** A piece that the design page build treats as optional (a missing file is skipped). */
const optional = (names) => names.filter((n) => fs.existsSync(path.join(SRC, n))).map(src).join("\n");
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const FACE_FILES = ["faces2.js", "faces3.js", "faces4.js", "faces5.js", "faces6.js"];
const DV_FILES = ["dv2.js", "dv3.js", "dv4.js", "dv5.js", "dv5pad.js", "dv6.js"];
const OPS_FILES = ["ops2.js", "ops3.js", "ops4.js", "ops5.js"];
const CSS_FILES = [
  "faces2.css", "faces3.css", "faces4.css", "faces5.css", "faces6.css",
  "dv2.css", "dv3.css", "dv4.css", "dv5.css", "dv6.css",
  "anim2.css", "anim3.css", "anim4.css", "anim5.css",
];

// ---- pieces of the saved 25-face page: icons, escaping, the first 25 faces, base CSS

const base = src("card_designs_base25.html");
const scriptStart = base.indexOf("<script>\n(function");
must(scriptStart > 0, "base page script not found");
const old = base.slice(scriptStart);
function cut(start, end) {
  const a = old.indexOf(start);
  must(a >= 0, `not found in base page: ${start}`);
  const b = end ? old.indexOf(end, a) : old.length;
  must(b > a, `end not found in base page: ${end}`);
  return old.slice(a, b);
}
const segIc = cut("  var IC={phone:", "  var PH=L('phone'");
const segIc2 = cut("  var IC2=", "  var ITEMS=");
const segEsc = cut("  function esc(", "\n") + "\n";
let segFaces = cut("  var D=[", "  var TAGS=");
const baseStyle = base.slice(base.indexOf("<style>") + 7, base.indexOf("</style>"));

// The only two pieces of sample text left in the faces.
function swap(text, from, to) {
  must(text.includes(from), `expected text not found: ${from}`);
  return text.replace(from, to);
}
segFaces = swap(segFaces, `<div class="big">J</div>`, `<div class="big">'+P.mono+'</div>`);
segFaces = swap(segFaces, `'+P.company+'<br>Dubai</span>`, `'+P.company+(P.addr?'<br>'+P.addr:'')+'</span>`);

// One more icon is added by the step-by-step page logic and used by some layouts.
const checkIcon = /IC\.check='[^']*';/.exec(src("wizard.js"));
must(checkIcon, "check icon not found in wizard.js");

// ---- palettes and the first 25 openings live in the page logic file

const app = src("app3.js");
const palMatch = /  var PAL=\[[\s\S]*?\n  \];/.exec(app);
must(palMatch, "palette list not found in app3.js");
const opsMatch = /  var OPS=\[\[.*\]\];/.exec(app);
must(opsMatch, "opening list not found in app3.js");

// ---- layouts: the real card's buttons are links, so the helper functions are replaced

function adaptLayoutFile(text, name) {
  text = swap(text, "function G(i){return i.m.indexOf('txt:')===0?'<b>'+i.m.slice(4)+'</b>':ic(i.m);}", "function G(i){return IH(i);}");
  text = swap(
    text,
    `'<a class="'+c+'" tabindex="0" role="link" aria-label="'+i.l+'"'`,
    `'<a class="'+c+'"'+LA(i)+' aria-label="'+i.l+'"'`,
  );
  must(!text.includes("ic(i.m)"), `${name}: another use of the sample icon keys`);
  return text;
}
const dvCode = DV_FILES.filter((n) => fs.existsSync(path.join(SRC, n)))
  .map((n) => (n === "dv5pad.js" ? src(n) : adaptLayoutFile(src(n), n)))
  .join("\n");

// ---- the engine

const head = read(PARTS, "engine-head.js").replace("/*@@IC@@*/", () => segIc).replace("/*@@ESC@@*/", () => segEsc);
const body = [
  head,
  palMatch[0],
  segFaces,
  optional(FACE_FILES),
  segIc2,
  checkIcon[0],
  read(PARTS, "base-layouts.js"),
  dvCode,
  opsMatch[0],
  optional(OPS_FILES),
].join("\n");
const engineSource = body + "\n" + read(PARTS, "engine-tail.js");

// Run the engine's data once (without the exports) to read the names and check the counts.
const sandbox = vm.createContext({});
const data = new vm.Script(
  "(function(){" + engineSource.replace(/^export /gm, "") + "\nreturn {D:D,DV:DV,OPS:OPS,PAL:PAL};})()",
).runInContext(sandbox);
must(data.D.length === 400, `expected 400 faces, got ${data.D.length}`);
must(data.DV.length === 400, `expected 400 layouts, got ${data.DV.length}`);
must(data.OPS.length === 400, `expected 400 openings, got ${data.OPS.length}`);
for (const f of data.D) must(f.p.length === 4 && f.p.every((i) => data.PAL[i]), `face ${f.n}: bad colourways`);

const minified = esbuild.transformSync(engineSource, { minify: true, format: "esm", target: "es2019", legalComments: "none" }).code;
const GENERATED = path.join(WEB, "src", "lib", "library", "generated");
fs.mkdirSync(GENERATED, { recursive: true });
fs.writeFileSync(path.join(GENERATED, "engine.js"), "// Generated by scripts/build-design-library.mjs. Do not edit.\n" + minified);

fs.writeFileSync(
  path.join(GENERATED, "engine.d.ts"),
  `// Generated by scripts/build-design-library.mjs. Do not edit.
import type { EngineInput, EngineResult } from "../types";
export function renderPage(input: EngineInput): EngineResult;
export function renderTab(input: EngineInput, group: "c" | "s" | "w"): string;
export const FACE_COUNT: number;
export const BELOW_COUNT: number;
export const INTRO_COUNT: number;
`,
);

// The fonts are not linked from a font host: they are self-hosted by scripts/copy-card-fonts.mjs.

// ---- one stylesheet, scoped under .cfl so nothing leaks into the rest of the app

const rawCss = [
  baseStyle.replace(".bt{font-size:2.6cqw;font-weight:700}.bs{font-size:2cqw;opacity:.7;letter-spacing:.16em;text-transform:uppercase}", ""),
  src("new2.css"),
  src("new3.css"),
  optional(CSS_FILES),
].join("\n");

const ROOT = ".cfl";
function scope(selector) {
  const s = selector.trim();
  if (/^(:root|html|body)(?![\w-])/.test(s)) return null; // page level rules of the design page
  if (s.startsWith("*")) return `:where(${ROOT}) ${s}`;
  return `${ROOT} ${s}`;
}
const tree = postcss.parse(rawCss);
tree.walkRules((rule) => {
  const parent = rule.parent;
  if (parent && parent.type === "atrule" && /keyframes$/i.test(parent.name)) return;
  const next = rule.selectors.map(scope).filter(Boolean);
  if (next.length) rule.selectors = next;
  else rule.remove();
});
tree.walkAtRules((at) => {
  if (/keyframes$|font-face/i.test(at.name)) return;
  if (at.nodes && at.nodes.length === 0) at.remove();
});
const supplement = read(PARTS, "supplement.css");
const css = esbuild.transformSync(tree.toString() + "\n" + supplement, { loader: "css", minify: true, legalComments: "none" }).code;
const version = crypto.createHash("sha1").update(css).digest("hex").slice(0, 8);
const PUBLIC = path.join(WEB, "public", "card-library");
fs.mkdirSync(PUBLIC, { recursive: true });
fs.writeFileSync(path.join(PUBLIC, "designs.css"), css);

// ---- names and colours for the pickers (small, no code)

const j = (v) => JSON.stringify(v);
const meta = `// Generated by scripts/build-design-library.mjs. Do not edit.
export interface PaletteMeta { name: string; bg: string; bg2: string; fg: string; acc: string; on: string }
export interface FaceMeta { n: string; tags: string[]; p: number[] }

export const PALETTES: PaletteMeta[] = ${j(data.PAL.map(({ n, bg, bg2, fg, acc, on }) => ({ name: n, bg, bg2, fg, acc, on })))};
export const FACE_META: FaceMeta[] = ${j(data.D.map((f) => ({ n: f.n, tags: f.tags, p: f.p })))};
export const BELOW_META: { n: string; d: string }[] = ${j(data.DV.map((v) => ({ n: v.n, d: v.d })))};
export const INTRO_META: [string, string][] = ${j(data.OPS)};
export const CSS_URL = ${j("/card-library/designs.css?v=" + version)};
`;
fs.writeFileSync(path.join(GENERATED, "meta.ts"), meta);

console.log(`engine.js ${Math.round(minified.length / 1024)} KB, designs.css ${Math.round(css.length / 1024)} KB (v${version})`);
