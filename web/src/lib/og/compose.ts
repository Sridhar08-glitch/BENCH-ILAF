// Draws the share-preview image of a public card (1200 x 630) with sharp: shapes as SVG, text through Pango (which shapes
// Arabic correctly), the photo as a circle and the company logo on a white chip. Server only.
import { existsSync } from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { INK, WHITE, cr, rgba } from "@/lib/library/company/colour";
import { initials, isRtlText, splitRuns, visualOrder } from "./runs";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface OgColours {
  bg: string;
  bg2: string;
  fg: string;
  acc: string;
  on: string;
}

export interface OgCard {
  name: string;
  title: string;
  company: string;
  photo?: Buffer | null;
  logo?: Buffer | null;
  colours: OgColours;
  /** The name of the product, drawn small in the footer. */
  appName: string;
  /** A short line next to it, in the card's language. */
  footer: string;
  /** The card page is read right to left. */
  rtl?: boolean;
}

/** The brand colours used when a card has none to show (generic image). */
export const BRAND_COLOURS: OgColours = { bg: "#101114", bg2: "#1D2027", fg: "#FFFFFF", acc: "#FF6B35", on: "#FFFFFF" };

type Weight = "medium" | "bold";

const FONT_FILES = {
  latin: { medium: "poppins-latin-500-normal.ttf", bold: "poppins-latin-700-normal.ttf" },
  arabic: { medium: "cairo-arabic-500-normal.ttf", bold: "cairo-arabic-700-normal.ttf" },
} as const;
const FONT_NAMES = {
  latin: { medium: "Poppins Medium", bold: "Poppins Bold" },
  arabic: { medium: "Cairo Medium", bold: "Cairo Bold" },
} as const;

/** The font file in public/og-fonts (made by scripts/copy-og-fonts.mjs at build time); without it the system's own fonts draw the text. */
function fontFile(script: "latin" | "arabic", weight: Weight): string | undefined {
  const file = path.join(process.cwd(), "public", "og-fonts", FONT_FILES[script][weight]);
  return existsSync(file) ? file : undefined;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Layer {
  input: Buffer;
  width: number;
  height: number;
}

async function runLayer(text: string, arabic: boolean, size: number, weight: Weight, colour: string): Promise<Layer> {
  const script = arabic ? "arabic" : "latin";
  const file = fontFile(script, weight);
  const img = await sharp({
    text: {
      text: `<span foreground="${colour}">${esc(text)}</span>`,
      font: `${FONT_NAMES[script][weight]} ${size}`,
      ...(file ? { fontfile: file } : {}),
      rgba: true,
      wrap: "none",
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: img.data, width: img.info.width, height: img.info.height };
}

/** One line of text as an image: runs of different scripts side by side, in screen order. Shrinks to fit `maxWidth`. */
export async function textLine(text: string, opts: { size: number; weight: Weight; colour: string; maxWidth: number; rtl: boolean; minSize?: number }): Promise<Layer | null> {
  const runs = visualOrder(splitRuns(text), opts.rtl);
  if (!runs.length) return null;
  let size = opts.size;
  const min = opts.minSize ?? Math.round(opts.size * 0.55);
  for (;;) {
    const layers = await Promise.all(runs.map((r) => runLayer(r.text, r.arabic, size, opts.weight, opts.colour)));
    const gap = Math.round(size * 0.28);
    const width = layers.reduce((n, l) => n + l.width, 0) + gap * (layers.length - 1);
    if (width <= opts.maxWidth || size <= min) {
      const height = Math.max(...layers.map((l) => l.height));
      let x = 0;
      const parts = layers.map((l) => {
        const part = { input: l.input, left: x, top: Math.round((height - l.height) / 2) };
        x += l.width + gap;
        return part;
      });
      let img = await sharp({ create: { width: Math.max(1, width), height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(parts)
        .png()
        .toBuffer();
      let w = width;
      if (w > opts.maxWidth) {
        img = await sharp(img).extract({ left: opts.rtl ? w - opts.maxWidth : 0, top: 0, width: opts.maxWidth, height }).png().toBuffer();
        w = opts.maxWidth;
      }
      return { input: img, width: w, height };
    }
    size = Math.max(min, Math.floor(size * Math.min(0.94, opts.maxWidth / width)));
  }
}

/** A text colour with enough contrast on the background: the wanted one, else white or ink. */
export function readableOn(bg: string, wanted: string, min = 4.5): string {
  if (cr(wanted, bg) >= min) return wanted;
  return cr(WHITE, bg) >= cr(INK, bg) ? WHITE : INK;
}

const circleMask = (d: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="#fff"/></svg>`);

async function photoCircle(photo: Buffer, d: number): Promise<Buffer | null> {
  try {
    return await sharp(photo)
      .rotate()
      .resize(d, d, { fit: "cover", position: "attention" })
      .composite([{ input: circleMask(d), blend: "dest-in" }])
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

async function logoChip(logo: Buffer): Promise<Layer | null> {
  try {
    const fitted = await sharp(logo, { density: 200 }).resize(230, 80, { fit: "inside", withoutEnlargement: false }).png().toBuffer({ resolveWithObject: true });
    const pad = 14;
    const w = fitted.info.width + pad * 2;
    const h = fitted.info.height + pad * 2;
    const chip = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${Math.round(h / 4)}" fill="#fff"/></svg>`), left: 0, top: 0 },
        { input: fitted.data, left: pad, top: pad },
      ])
      .png()
      .toBuffer();
    return { input: chip, width: w, height: h };
  } catch {
    return null;
  }
}

function backdrop(c: OgColours, rtl: boolean): string {
  const bigCx = rtl ? 40 : OG_WIDTH - 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.bg}"/><stop offset="1" stop-color="${c.bg2}"/></linearGradient></defs>
<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#g)"/>
<circle cx="${bigCx}" cy="40" r="260" fill="${rgba(c.acc, 0.14)}"/>
<circle cx="${rtl ? OG_WIDTH - 90 : 90}" cy="${OG_HEIGHT + 40}" r="200" fill="${rgba(c.fg, 0.06)}"/>
<rect x="0" y="${OG_HEIGHT - 76}" width="${OG_WIDTH}" height="76" fill="${rgba(c.fg, 0.08)}"/>
<rect x="0" y="${OG_HEIGHT - 80}" width="${OG_WIDTH}" height="4" fill="${c.acc}"/>
</svg>`;
}

/** The share-preview image of a card, as a PNG. */
export async function renderCardOg(card: OgCard): Promise<Buffer> {
  const rtl = card.rtl ?? isRtlText(`${card.name} ${card.title} ${card.company}`);
  const c = card.colours;
  const fg = readableOn(c.bg, c.fg);
  const accent = readableOn(c.bg, c.acc, 3);
  const layers: OverlayOptions[] = [];
  const place = (left: number, width: number) => (rtl ? OG_WIDTH - left - width : left);

  // The picture: a circle with a ring, or the initials on the accent colour.
  const D = 300;
  const px = place(90, D);
  const py = 140;
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${D + 24}" height="${D + 24}"><circle cx="${(D + 24) / 2}" cy="${(D + 24) / 2}" r="${(D + 24) / 2 - 5}" fill="none" stroke="${c.acc}" stroke-width="6"/></svg>`), left: px - 12, top: py - 12 });
  const photo = card.photo ? await photoCircle(card.photo, D) : null;
  if (photo) {
    layers.push({ input: photo, left: px, top: py });
  } else {
    const on = readableOn(c.acc, c.on);
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${D}" height="${D}"><circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}" fill="${c.acc}"/></svg>`), left: px, top: py });
    // Arabic letters join, so a single first letter stands alone better than two letters side by side.
    const letters = initials(card.name) || card.appName.slice(0, 1);
    const mark = await textLine(rtl ? Array.from(letters)[0] : letters, { size: 110, weight: "bold", colour: on, maxWidth: D - 60, rtl: false });
    if (mark) layers.push({ input: mark.input, left: px + Math.round((D - mark.width) / 2), top: py + Math.round((D - mark.height) / 2) });
  }

  // The words: name, title, company, stacked and centred on the picture.
  const colW = 640;
  const colLeft = 450;
  const lines = [
    await textLine(card.name, { size: 68, weight: "bold", colour: fg, maxWidth: colW, rtl, minSize: 40 }),
    await textLine(card.title, { size: 38, weight: "medium", colour: fg, maxWidth: colW, rtl, minSize: 24 }),
    await textLine(card.company, { size: 36, weight: "bold", colour: accent, maxWidth: colW, rtl, minSize: 24 }),
  ];
  const gaps = [0, 14, 10];
  const shown = lines.map((l, i) => (l ? { l, gap: gaps[i] } : null)).filter((x): x is { l: Layer; gap: number } => x !== null);
  const total = shown.reduce((n, s, i) => n + s.l.height + (i ? s.gap : 0), 0);
  let y = Math.round(py + D / 2 - total / 2);
  shown.forEach((s, i) => {
    if (i) y += s.gap;
    layers.push({ input: s.l.input, left: rtl ? OG_WIDTH - colLeft - s.l.width : colLeft, top: y });
    y += s.l.height;
  });

  // The company logo, top corner opposite the picture's side.
  const chip = card.logo ? await logoChip(card.logo) : null;
  if (chip) layers.push({ input: chip.input, left: rtl ? 60 : OG_WIDTH - chip.width - 60, top: 44 });

  // Footer: the product name and a short line.
  const footMuted = readableOn(c.bg, c.fg, 4.5);
  const brand = await textLine(card.appName, { size: 30, weight: "bold", colour: accent, maxWidth: 300, rtl: false });
  const line = await textLine(card.footer, { size: 26, weight: "medium", colour: footMuted, maxWidth: 600, rtl });
  const fy = OG_HEIGHT - 76 + 8;
  if (brand) layers.push({ input: brand.input, left: rtl ? OG_WIDTH - 60 - brand.width : 60, top: fy + Math.round((60 - brand.height) / 2) });
  if (line) layers.push({ input: line.input, left: rtl ? 60 : OG_WIDTH - 60 - line.width, top: fy + Math.round((60 - line.height) / 2) });

  return sharp(Buffer.from(backdrop(c, rtl))).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

/** The picture for a card that is missing, paused or removed: only the product, nothing personal. */
export async function renderGenericOg(opts: { appName: string; line: string; rtl?: boolean }): Promise<Buffer> {
  const c = BRAND_COLOURS;
  const rtl = !!opts.rtl;
  const brand = await textLine(opts.appName, { size: 120, weight: "bold", colour: WHITE, maxWidth: 900, rtl: false });
  const line = await textLine(opts.line, { size: 40, weight: "medium", colour: WHITE, maxWidth: 900, rtl });
  const layers: OverlayOptions[] = [];
  const total = (brand?.height ?? 0) + (line ? line.height + 24 : 0);
  let y = Math.round((OG_HEIGHT - total) / 2);
  if (brand) {
    layers.push({ input: brand.input, left: Math.round((OG_WIDTH - brand.width) / 2), top: y });
    y += brand.height + 24;
  }
  if (line) layers.push({ input: line.input, left: Math.round((OG_WIDTH - line.width) / 2), top: y });
  return sharp(Buffer.from(backdrop(c, false))).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}
