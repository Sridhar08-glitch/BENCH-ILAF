// Renders page styles (tops) with realistic sample cards through the real engine path (renderCardPage + designs.css +
// self-hosted card fonts) and screenshots them with Playwright. Usage:
//   node scripts/shoot-pages.mjs 28-37 [--w=320,390,430] [--cases=full,few,bare,long,ar,many] [--out=.lab/shots]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const range = process.argv[2] || "28-28";
const [a, b] = range.split("-").map(Number);
const widths = arg("w", "390").split(",").map(Number);
const cases = arg("cases", "full").split(",");
const out = path.resolve(WEB, arg("out", ".lab/shots"));
const colour = Number(arg("colour", "0"));
fs.mkdirSync(out, { recursive: true });
const GENERATED = path.join(WEB, "src/lib/library/generated");
const genDir = arg("gen", "") ? path.resolve(WEB, arg("gen", "")) : GENERATED;
const bundle = path.join(WEB, ".lab", `render.${path.basename(genDir)}.${process.pid}.cjs`);
// --gen=<dir> draws with the engine and meta that build-pages wrote to PAGES_OUT_DIR=<dir> (a private build), not the committed ones
const genPlugin = { name: "gen", setup(b) {
  b.onResolve({ filter: /generated\/(engine|meta)$/ }, (a) => ({ path: path.join(genDir, a.path.endsWith("engine") ? "engine.js" : "meta.ts") }));
  b.onResolve({ filter: /^\.\/pack2\.js$/ }, () => ({ path: path.join(GENERATED, "pack2.js") }));
} };
await esbuild.build({ entryPoints: [path.join(WEB, "src/lib/library/render.ts")], bundle: true, platform: "node", format: "cjs", outfile: bundle, logLevel: "error", external: ["react", "react-dom"], tsconfig: path.join(WEB, "tsconfig.json"), loader: { ".ts": "ts" }, plugins: [genPlugin] });
const { createRequire } = await import("node:module");
const { renderCardPage } = createRequire(import.meta.url)(bundle);

// --photo=portrait|landscape|square (test pictures in scripts/test-photos, made by scripts/test-photos/make-portraits.py) or logo (the Bench logo, an odd sample)
const photoName = arg("photo", "portrait");
const PHOTO = pathToFileURL(photoName === "logo" ? path.join(WEB, "public/brand/bench-logo.png") : path.join(WEB, "scripts/test-photos", `${photoName}.jpg`)).href;
const COVER = pathToFileURL(path.join(WEB, "scripts/test-photos", `${arg("cover", "landscape")}.jpg`)).href;
const ITEMS9 = [
  { kind: "Mobile", value: "+974 5555 0123" }, { kind: "WhatsApp", value: "+974 5555 0123" }, { kind: "Email", value: "noura@gulf-group.qa" },
  { kind: "Website", value: "gulf-group.qa" }, { kind: "LinkedIn", value: "https://linkedin.com/in/noura-alkuwari" }, { kind: "Location", value: "West Bay, Doha" },
  { kind: "Instagram", value: "noura.k" }, { kind: "X", value: "noura_k" }, { kind: "Calendly", value: "calendly.com/noura" },
];
const base = { name: "Noura Al-Kuwari", title: "Business Consultant", company: "Gulf Group", address: "Doha, Qatar", bio: "I help family businesses in the Gulf build lasting partnerships and clear growth plans.", photoUrl: PHOTO, coverUrl: null, saveContact: true, publicUrl: "https://bench.test/c/noura", brand: null, locale: "en" };
const CASES = {
  full: { items: ITEMS9.slice(0, 6), coverUrl: COVER },
  art: { items: ITEMS9.slice(0, 6) },
  few: { items: ITEMS9.slice(0, 3), photoUrl: null, coverUrl: null },
  many: { items: ITEMS9 },
  bare: { items: ITEMS9.slice(0, 2), title: "", company: "", address: "", bio: "", photoUrl: null, coverUrl: null },
  long: { name: "Abdulrahman Mohammed Al-Thani-Hashemi", title: "Chief Strategy and Partnerships Officer, Middle East", company: "Gulf Infrastructure & Development Holdings", items: ITEMS9.slice(0, 6) },
  ar: { name: "نورة الكواري", title: "مستشارة أعمال", company: "مجموعة الخليج", address: "الدوحة، قطر", bio: "أساعد الشركات العائلية في الخليج على بناء شراكات طويلة الأمد وخطط نمو واضحة.", locale: "ar", items: ITEMS9.slice(0, 6) },
};
const exe = "C:/Users/pertr/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe";
const browser = await chromium.launch({ executablePath: exe });
const css = pathToFileURL(genDir === GENERATED ? path.join(WEB, "public/card-library/designs.css") : path.join(genDir, "designs.css")).href;
const fonts = pathToFileURL(path.join(WEB, "public/card-fonts/fonts.css")).href;
// the pictures of the page styles are absolute (/card-library/art/..): point them at the public folder for file:// pages
const pagesSrc = path.join(genDir === GENERATED ? path.join(WEB, "public/card-library") : genDir, "pages.css");
let pagesCssHref = "";
if (fs.existsSync(pagesSrc)) {
  const localPages = path.join(out, "_pages.css");
  fs.writeFileSync(localPages, fs.readFileSync(pagesSrc, "utf8").split("/card-library/art/").join(pathToFileURL(path.join(WEB, "public/card-library/art")).href + "/"));
  pagesCssHref = pathToFileURL(localPages).href;
}
const report = [];
for (let top = a; top <= b; top++) {
  for (const cs of cases) {
    const data = { ...base, ...CASES[cs], design: { face: 1, colour, top, below: 400 + top, intro: 0, font: "face", size: 100, photo: true, brand_colors: false, foot: true } };
    const r = renderCardPage(data, "live");
    const html = `<!doctype html><html lang="${data.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${css}">${pagesCssHref ? `<link rel="stylesheet" href="${pagesCssHref}">` : ""}<link rel="stylesheet" href="${fonts}"><style>body{margin:0;background:${r.pageVars["--pgbg"] || "#222"};color:${r.pageVars["--pgfg"] || "#fff"};font-family:system-ui}.cfl{padding:12px 12px 24px}.sv{display:block;margin:10px auto;padding:12px 20px;border-radius:10px;border:0;background:${r.pageVars["--pacc"] || "#444"};color:${r.pageVars["--pon"] || "#fff"};font-weight:700;width:100%}</style></head><body><div dir="ltr" class="cfl ${r.wrapClass}" style="${Object.entries(r.pageVars).map(([k, v]) => k + ":" + v).join(";")}">${r.html}</div></body></html>`;
    const file = path.join(out, `t${top}-${cs}.html`);
    fs.writeFileSync(file, html);
    for (const w of widths) {
      const p = await browser.newPage({ viewport: { width: w, height: 800 }, deviceScaleFactor: 1 });
      await p.goto(pathToFileURL(file).href);
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(500);
      const m = await p.evaluate(() => {
        const bad = [];
        document.querySelectorAll(".pg-top *,.pg-bt *").forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && r.right > innerWidth + 1) bad.push(e.className || e.tagName); });
        return { sw: document.documentElement.scrollWidth, iw: innerWidth, bad: [...new Set(bad)].slice(0, 5) };
      });
      await p.screenshot({ path: path.join(out, `t${top}-${cs}-${w}.png`), fullPage: true });
      report.push(`t${top} ${cs} ${w}: scrollWidth ${m.sw}/${m.iw}${m.sw > m.iw ? " OVERFLOW " + m.bad.join(",") : ""}`);
      await p.close();
    }
  }
}
await browser.close();
fs.rmSync(bundle, { force: true });
console.log(report.join("\n"));
