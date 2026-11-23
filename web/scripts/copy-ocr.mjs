// Copies what the paper-card scanner needs into public/ocr so it all loads from this site, never from a CDN:
// the OCR worker, the three LSTM engine builds (the browser picks the fastest it supports) and the English and
// Arabic language files. Runs before `npm run build` (see "prebuild" in package.json). Safe to run again.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "ocr");
mkdirSync(out, { recursive: true });

const files = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "eng.traineddata.gz"],
  ["node_modules/@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz", "ara.traineddata.gz"],
];

let missing = 0;
for (const [from, to] of files) {
  const src = join(root, from);
  if (!existsSync(src)) {
    console.warn(`copy-ocr: ${from} is not installed (run npm install). The scanner will ask for pasted text instead.`);
    missing += 1;
    continue;
  }
  const dest = join(out, to);
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
  copyFileSync(src, dest);
  console.log(`copy-ocr: ${to}`);
}
if (missing === 0) console.log("copy-ocr: ready in public/ocr");
