// Tiles the PNGs of scripts/shoot-pages.mjs into contact sheets: node scripts/shoot-montage.mjs <dir> <case> <width> <from> <to> [perSheet=10] [scale=0.5] [maxH=1400]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
const [dir, cs, w, from, to, per = "10", scale = "0.5", maxH = "1400"] = process.argv.slice(2);
const exe = "C:/Users/pertr/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe";
const browser = await chromium.launch({ executablePath: exe });
for (let a = +from; a <= +to; a += +per) {
  const ids = Array.from({ length: Math.min(+per, +to - a + 1) }, (_, i) => a + i).filter((n) => fs.existsSync(path.join(dir, `t${n}-${cs}-${w}.png`)));
  const html = `<body style="margin:0;background:#888;display:flex;gap:6px;align-items:flex-start">${ids.map((n) => `<div style="width:${w * scale}px;height:${maxH * scale}px;overflow:hidden;position:relative;background:#fff"><img src="${pathToFileURL(path.join(dir, `t${n}-${cs}-${w}.png`)).href}" style="width:${w * scale}px"><b style="position:absolute;left:2px;top:2px;background:#000;color:#fff;font:bold 11px sans-serif;padding:1px 3px">${n}</b></div>`).join("")}</body>`;
  const f = path.join(dir, `_m${a}.html`);
  fs.writeFileSync(f, html);
  const p = await browser.newPage({ viewport: { width: Math.round(ids.length * (w * scale + 6)), height: Math.round(maxH * scale) } });
  await p.goto(pathToFileURL(f).href);
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(dir, `_sheet-${cs}-${a}.png`) });
  await p.close();
}
await browser.close();
