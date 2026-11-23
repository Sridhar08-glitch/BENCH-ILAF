// Makes the extra app icons the web app manifest names, from public/brand/icon-512.png:
//   icon-192.png            the 192 px icon (Android launcher, install prompt)
//   icon-maskable-512.png   the icon on a full-bleed ink square with a safe margin, for adaptive icons that crop to a circle or squircle
// The results are committed; run `node scripts/make-pwa-icons.mjs` only when the source icon changes.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const brand = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "brand");
const src = join(brand, "icon-512.png");
const INK = "#101114";

await sharp(src).resize(192, 192).png({ compressionLevel: 9 }).toFile(join(brand, "icon-192.png"));

// Adaptive icons keep only the middle 80% safe, so the mark is drawn at 70% of the square.
const inner = await sharp(src).resize(358, 358).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: INK } })
  .composite([{ input: inner, gravity: "center" }])
  .png({ compressionLevel: 9 })
  .toFile(join(brand, "icon-maskable-512.png"));
console.log("make-pwa-icons: icon-192.png and icon-maskable-512.png written");
