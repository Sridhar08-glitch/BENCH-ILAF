// The video-call background maker: a 1920x1080 picture with the card's QR code, name, title and company logo.
// The layout is plain geometry (testable without a screen); `drawBackground` paints it on any canvas-like context.
//
// A background is seen small and mostly covered by the person in front of it. So text is large, and every
// layout keeps a "person zone" in the middle of the picture clear of text, logo and QR code.
import QRCode from "qrcode";
import { qrModules } from "@/lib/card/qr";
import { drawStyledQr, type PathCtx } from "@/lib/qr/canvas";
import type { QrStyle } from "@/lib/qr/style";
import { tk, type MessageKey } from "@/lib/i18n";

export const WIDTH = 1920;
export const HEIGHT = 1080;

export type BackgroundLayout = "qr-left" | "qr-right" | "centred" | "corner" | "banner" | "minimal";
export type BackgroundTheme = "brand" | "dark" | "light";

export const LAYOUTS: { key: BackgroundLayout; name: MessageKey; hint: MessageKey }[] = [
  { key: "qr-left", name: tk("tools.bgLayoutQrLeft"), hint: tk("tools.bgLayoutQrLeftHint") },
  { key: "qr-right", name: tk("tools.bgLayoutQrRight"), hint: tk("tools.bgLayoutQrRightHint") },
  { key: "centred", name: tk("tools.bgLayoutCentred"), hint: tk("tools.bgLayoutCentredHint") },
  { key: "corner", name: tk("tools.bgLayoutCorner"), hint: tk("tools.bgLayoutCornerHint") },
  { key: "banner", name: tk("tools.bgLayoutBanner"), hint: tk("tools.bgLayoutBannerHint") },
  { key: "minimal", name: tk("tools.bgLayoutMinimal"), hint: tk("tools.bgLayoutMinimalHint") },
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a seated person usually is. Nothing is drawn here. */
export const PERSON_ZONE: Rect = { x: 600, y: 260, w: 720, h: HEIGHT - 260 };

export type Align = "left" | "centre" | "right";

export interface TextSpec {
  /** The box the text must fit in. The text is made smaller, never wider, to fit. */
  box: Rect;
  size: number;
  weight: "bold" | "normal";
  align: Align;
}

export interface LayoutSpec {
  /** A solid bar behind the content, if any. */
  bar: Rect | null;
  name: TextSpec;
  title: TextSpec;
  logo: Rect | null;
  qr: Rect;
}

/** Smallest sizes (pixels at 1920 wide) that stay readable when the picture is shown at a quarter of that. */
export const MIN_NAME_SIZE = 56;
export const MIN_TITLE_SIZE = 32;
export const MIN_QR = 150;

const M = 64;

export function layoutFor(layout: BackgroundLayout): LayoutSpec {
  switch (layout) {
    case "qr-left":
      return {
        bar: null,
        logo: { x: M, y: 70, w: 360, h: 110 },
        name: { box: { x: M, y: 230, w: 460, h: 130 }, size: 72, weight: "bold", align: "left" },
        title: { box: { x: M, y: 380, w: 460, h: 100 }, size: 38, weight: "normal", align: "left" },
        qr: { x: M, y: 540, w: 360, h: 360 },
      };
    case "qr-right":
      return {
        bar: null,
        logo: { x: WIDTH - M - 360, y: 70, w: 360, h: 110 },
        name: { box: { x: WIDTH - M - 460, y: 230, w: 460, h: 130 }, size: 72, weight: "bold", align: "right" },
        title: { box: { x: WIDTH - M - 460, y: 380, w: 460, h: 100 }, size: 38, weight: "normal", align: "right" },
        qr: { x: WIDTH - M - 360, y: 540, w: 360, h: 360 },
      };
    case "centred":
      return {
        bar: null,
        logo: { x: WIDTH / 2 - 160, y: 26, w: 320, h: 70 },
        name: { box: { x: 300, y: 104, w: 1320, h: 80 }, size: 72, weight: "bold", align: "centre" },
        title: { box: { x: 300, y: 190, w: 1320, h: 52 }, size: 38, weight: "normal", align: "centre" },
        qr: { x: M, y: 40, w: 190, h: 190 },
      };
    case "corner":
      return {
        bar: null,
        logo: { x: M, y: HEIGHT - 400, w: 300, h: 90 },
        name: { box: { x: M, y: HEIGHT - 290, w: 500, h: 110 }, size: 68, weight: "bold", align: "left" },
        title: { box: { x: M, y: HEIGHT - 170, w: 500, h: 90 }, size: 36, weight: "normal", align: "left" },
        qr: { x: WIDTH - M - 300, y: HEIGHT - 300 - M, w: 300, h: 300 },
      };
    case "banner":
      return {
        bar: { x: 0, y: 0, w: WIDTH, h: 220 },
        logo: { x: M, y: 40, w: 280, h: 140 },
        name: { box: { x: 400, y: 36, w: 1100, h: 90 }, size: 76, weight: "bold", align: "left" },
        title: { box: { x: 400, y: 130, w: 1100, h: 60 }, size: 40, weight: "normal", align: "left" },
        qr: { x: WIDTH - M - 160, y: 30, w: 160, h: 160 },
      };
    default:
      return {
        bar: null,
        logo: null,
        name: { box: { x: M, y: HEIGHT - 210, w: 520, h: 90 }, size: 60, weight: "bold", align: "left" },
        title: { box: { x: M, y: HEIGHT - 120, w: 520, h: 60 }, size: 34, weight: "normal", align: "left" },
        qr: { x: WIDTH - M - 170, y: HEIGHT - 170 - M, w: 170, h: 170 },
      };
  }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Every rectangle a layout draws (the bar is a background, not content). */
export function contentRects(spec: LayoutSpec): Rect[] {
  return [spec.name.box, spec.title.box, spec.qr, ...(spec.logo ? [spec.logo] : [])];
}

export interface Palette {
  bg: string;
  bg2: string;
  fg: string;
  acc: string;
  on: string;
}

export interface BackgroundColours {
  /** Background fill (two colours for a soft gradient). */
  from: string;
  to: string;
  /** Text colour on the background. */
  text: string;
  /** Second line of text. */
  muted: string;
  accent: string;
  /** Bar colour and text on the bar (banner layout). */
  bar: string;
  barText: string;
  /** Tile under the QR code, and the QR's own dark colour: always dark on white so phones read it. */
  qrTile: string;
  qrInk: string;
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a);
  const [r2, g2, b2] = p(b);
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(r1 + (r2 - r1) * t)}${h(g1 + (g2 - g1) * t)}${h(b1 + (b2 - b1) * t)}`.toUpperCase();
}

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Colours for a theme. "brand" uses the palette as it is, "dark" and "light" keep only its accent. `soft` is the blur-friendly look: a quiet gradient. */
export function coloursFor(p: Palette, theme: BackgroundTheme, soft: boolean): BackgroundColours {
  const ink = "#101114";
  const paper = "#FFFFFF";
  let from = p.bg;
  let to = p.bg2;
  let text = p.fg;
  if (theme === "dark") {
    from = "#101114";
    to = "#23262E";
    text = paper;
  } else if (theme === "light") {
    from = "#FFFFFF";
    to = "#EEF0F4";
    text = ink;
  }
  if (soft) {
    // A gentle gradient between the two colours and a little of the accent: no hard edges, so a blurred copy looks the same.
    to = mix(from, theme === "light" ? p.acc : theme === "dark" ? p.acc : p.bg2, theme === "brand" ? 0.5 : 0.18);
  }
  // Text must read on both ends of the gradient.
  const worst = contrast(text, from) < contrast(text, to) ? from : to;
  if (contrast(text, worst) < 4.5) text = lum(worst) > 0.4 ? ink : paper;
  const muted = mix(text, from, 0.28);
  // The banner bar is the accent colour; it is darkened a little when neither ink nor white would read on it.
  let barBg = p.acc;
  const readable = (bg: string) => contrast(paper, bg) >= 4.5 || contrast(ink, bg) >= 4.5;
  for (let i = 0; i < 8 && !readable(barBg); i++) barBg = mix(barBg, ink, 0.2);
  const barText = contrast(p.on, barBg) >= 4.5 ? p.on : contrast(ink, barBg) >= contrast(paper, barBg) ? ink : paper;
  return { from, to, text, muted, accent: p.acc, bar: barBg, barText, qrTile: paper, qrInk: ink };
}

export interface BackgroundSpec {
  layout: BackgroundLayout;
  theme: BackgroundTheme;
  soft: boolean;
  palette: Palette;
  name: string;
  title: string;
  company: string;
  /** The text a phone camera opens. */
  qrText: string;
  /** The card's saved QR look (dot and corner shapes); the colours stay dark on white so phones read it. */
  qrStyle?: QrStyle | null;
}

/** The title line: job title and company, or whichever exists. */
export function titleLine(title: string, company: string): string {
  return [title.trim(), company.trim()].filter(Boolean).join(" - ");
}

/** The parts of the 2D context that are used, so the drawing can be tested with a recorder. */
export interface Ctx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(o: number, c: string): void };
  beginPath(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  fill(path?: Path2D, rule?: CanvasFillRule): void;
  translate?(x: number, y: number): void;
  scale?(x: number, y: number): void;
  save(): void;
  restore(): void;
  drawImage(img: CanvasImageSource, x: number, y: number, w: number, h: number): void;
}

const FONT = '"Poppins","Segoe UI",Tahoma,Arial,sans-serif';

/** The largest size up to `size` at which `text` fits the box width. */
export function fitSize(ctx: Pick<Ctx, "font" | "measureText">, text: string, spec: TextSpec, floor: number): number {
  let size = spec.size;
  for (; size > floor; size -= 2) {
    ctx.font = `${spec.weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= spec.box.w) return size;
  }
  return floor;
}

function drawText(ctx: Ctx, text: string, spec: TextSpec, colour: string, floor: number): void {
  if (!text.trim()) return;
  const size = fitSize(ctx, text, spec, floor);
  ctx.font = `${spec.weight} ${size}px ${FONT}`;
  ctx.fillStyle = colour;
  ctx.textBaseline = "middle";
  const { box, align } = spec;
  ctx.textAlign = align === "left" ? "left" : align === "right" ? "right" : "center";
  const x = align === "left" ? box.x : align === "right" ? box.x + box.w : box.x + box.w / 2;
  ctx.fillText(text, x, box.y + box.h / 2);
}

function drawQr(ctx: Ctx, text: string, r: Rect, colours: BackgroundColours, style?: QrStyle | null): void {
  const pad = Math.round(r.w * 0.06);
  ctx.fillStyle = colours.qrTile;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  // A saved look with its own dot and corner shapes: drawn from the same paths as the QR page (browsers only).
  if (style && ctx.translate && ctx.scale && typeof Path2D !== "undefined") {
    const modules = qrModules(text, "M");
    if (modules) return drawStyledQr(ctx as unknown as PathCtx, modules, style, { x: r.x + pad, y: r.y + pad, w: r.w - 2 * pad }, 2, colours.qrInk);
  }
  let code;
  try {
    code = QRCode.create(text, { errorCorrectionLevel: "M" });
  } catch {
    return;
  }
  const n = code.modules.size;
  const quiet = 2;
  const cell = (r.w - 2 * pad) / (n + 2 * quiet);
  ctx.fillStyle = colours.qrInk;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (code.modules.get(y, x)) ctx.fillRect(Math.round(r.x + pad + (x + quiet) * cell), Math.round(r.y + pad + (y + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
    }
  }
}

/** Paint the background. `logo` is an already loaded picture (or null when there is none or it could not be read). */
export function drawBackground(ctx: Ctx, spec: BackgroundSpec, logo: { image: CanvasImageSource; width: number; height: number } | null): void {
  const c = coloursFor(spec.palette, spec.theme, spec.soft);
  const L = layoutFor(spec.layout);
  const g = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  g.addColorStop(0, c.from);
  g.addColorStop(1, c.to);
  ctx.fillStyle = g as unknown as string;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (L.bar) {
    ctx.fillStyle = c.bar;
    ctx.fillRect(L.bar.x, L.bar.y, L.bar.w, L.bar.h);
  }
  const onBar = !!L.bar;
  const text = onBar ? c.barText : c.text;
  drawText(ctx, spec.name.trim(), L.name, text, MIN_NAME_SIZE);
  drawText(ctx, titleLine(spec.title, spec.company), L.title, onBar ? c.barText : c.muted, MIN_TITLE_SIZE);
  if (L.logo && logo && logo.width > 0 && logo.height > 0) {
    // The logo keeps its shape inside its box, and sits on a light tile so a dark logo is never lost on a dark background.
    const r = L.logo;
    const scale = Math.min(r.w / logo.width, r.h / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    const x = L.name.align === "right" ? r.x + r.w - w : L.name.align === "centre" ? r.x + (r.w - w) / 2 : r.x;
    const y = r.y + (r.h - h) / 2;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x - 12, y - 8, w + 24, h + 16);
    ctx.drawImage(logo.image, x, y, w, h);
  }
  drawQr(ctx, spec.qrText, L.qr, c, spec.qrStyle);
}
