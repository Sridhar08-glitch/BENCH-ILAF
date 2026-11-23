// Draws a styled QR code as SVG text (and as path data a canvas can fill). Pure: no DOM, so it runs on the server and in tests.
// Coordinates are in modules; the caller scales them. The dark modules and the three corner squares are separate paths.
import type { QrModules } from "@/lib/card/qr";
import { MAX_LABEL, effectiveStyle, inkOn, logoSide, type DotShape, type EyeShape, type QrStyle } from "./style";

const f = (n: number) => String(Math.round(n * 1000) / 1000);

/** A rectangle with a radius per corner (top-left, top-right, bottom-right, bottom-left), as one closed path. */
export function rrect(x: number, y: number, w: number, h: number, tl: number, tr: number, br: number, bl: number): string {
  const c = (r: number) => Math.min(r, w / 2, h / 2);
  [tl, tr, br, bl] = [c(tl), c(tr), c(br), c(bl)];
  const arc = (r: number, dx: number, dy: number) => (r > 0 ? `a${f(r)} ${f(r)} 0 0 1 ${f(dx)} ${f(dy)}` : "");
  return `M${f(x + tl)} ${f(y)}h${f(w - tl - tr)}${arc(tr, tr, tr)}v${f(h - tr - br)}${arc(br, -br, br)}h${f(-(w - br - bl))}${arc(bl, -bl, -bl)}v${f(-(h - bl - tl))}${arc(tl, tl, -tl)}z`;
}

function modulePath(shape: DotShape, x: number, y: number): string {
  switch (shape) {
    case "dots": {
      const r = 0.46;
      return `M${f(x + 0.5 - r)} ${f(y + 0.5)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0z`;
    }
    case "rounded":
      return rrect(x, y, 1, 1, 0.32, 0.32, 0.32, 0.32);
    case "classy":
      return rrect(x, y, 1, 1, 0.5, 0, 0.5, 0);
    default:
      return `M${x} ${y}h1v1h-1z`;
  }
}

/** The top-left corner (row, col) of the three finder squares. */
export function eyeOrigins(size: number): { row: number; col: number }[] {
  return [{ row: 0, col: 0 }, { row: 0, col: size - 7 }, { row: size - 7, col: 0 }];
}

const inEye = (size: number, r: number, c: number) => eyeOrigins(size).some((o) => r >= o.row && r < o.row + 7 && c >= o.col && c < o.col + 7);

/** One corner square: a ring and a centre block, drawn with the ring's hole cut out (use fill-rule evenodd). */
export function eyePath(shape: EyeShape, x: number, y: number): string {
  const sq = (r: number) => (shape === "square" ? 0 : r);
  // The leaf has two rounded corners (top-left and bottom-right) and two sharp ones.
  const corners = (r: number): [number, number, number, number] => (shape === "leaf" ? [r, 0, r, 0] : [sq(r), sq(r), sq(r), sq(r)]);
  const outer = rrect(x, y, 7, 7, ...corners(shape === "leaf" ? 3.2 : 2.2));
  const hole = rrect(x + 1, y + 1, 5, 5, ...corners(shape === "leaf" ? 2.2 : 1.3));
  const centre = rrect(x + 2, y + 2, 3, 3, ...corners(shape === "leaf" ? 1.5 : 1.1));
  return `${outer}${hole}${centre}`;
}

export interface QrPaths {
  /** Dark data modules (no corner squares, nothing under the logo). */
  dots: string;
  /** The three corner squares. */
  eyes: string;
  /** Number of modules along a side. */
  size: number;
  /** Side of the square left empty for a logo, in modules (0 when there is none), and where it starts. */
  hole: { side: number; at: number };
}

/** Path data for a code. `logo` makes room in the middle for a picture (at most 20% of the area). */
export function qrPaths(modules: QrModules, style: QrStyle, logo: boolean): QrPaths {
  const s = effectiveStyle(style);
  const n = modules.size;
  const side = logo ? logoSide(n) : 0;
  const at = Math.floor((n - side) / 2);
  let dots = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!modules.dark(r, c) || inEye(n, r, c)) continue;
      if (side && r >= at && r < at + side && c >= at && c < at + side) continue;
      dots += modulePath(s.dots, c, r);
    }
  }
  const eyes = eyeOrigins(n).map((o) => eyePath(s.eyes, o.col, o.row)).join("");
  return { dots, eyes, size: n, hole: { side, at } };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface FrameLayout {
  width: number;
  height: number;
  /** Where the code tile (code plus quiet margin) starts, and its side. */
  tile: { x: number; y: number; side: number };
  /** SVG drawn under the tile and over it (frame parts, the label). */
  under: string;
  over: string;
}

/** Sizes and decoration of the frame around the code tile. Everything is in modules. */
export function frameLayout(n: number, style: QrStyle): FrameLayout {
  const s = effectiveStyle(style);
  const side = n + 2 * s.quiet;
  const frameColor = s.frameColor || s.fg;
  const label = s.label.trim().slice(0, MAX_LABEL);
  const p = Math.max(2, Math.round(n * 0.1));
  const labelH = label ? Math.max(4, Math.round(n * 0.19)) : 0;
  const gap = label ? Math.max(1, Math.round(n * 0.05)) : 0;
  const thick = Math.max(0.6, n * 0.03);
  const font = `font-family="Poppins, 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif" font-weight="600" text-anchor="middle" dominant-baseline="central"`;
  const text = (cx: number, cy: number, w: number, fill: string) => {
    if (!label) return "";
    // A rough width per letter keeps the words inside the frame; long labels get a smaller size.
    const size = Math.min(labelH * 0.56, (w * 0.9) / Math.max(4, label.length * 0.62));
    return `<text x="${f(cx)}" y="${f(cy)}" font-size="${f(size)}" fill="${fill}" ${font}>${esc(label)}</text>`;
  };
  const base = (w: number, h: number, rx: number, fill: string, extra = "") => `<rect width="${f(w)}" height="${f(h)}" rx="${f(rx)}" fill="${fill}"${extra}/>`;

  switch (s.frame) {
    case "box": {
      const w = side + 2 * p;
      const h = side + 2 * p + (label ? labelH + gap : 0);
      return {
        width: w, height: h, tile: { x: p, y: p, side },
        under: base(w, h, p, s.bg) + `<rect x="${f(thick / 2)}" y="${f(thick / 2)}" width="${f(w - thick)}" height="${f(h - thick)}" rx="${f(p)}" fill="none" stroke="${frameColor}" stroke-width="${f(thick)}"/>`,
        over: text(w / 2, p + side + gap + labelH / 2 - 0.5, w - 2 * p, s.fg),
      };
    }
    case "bar":
    case "bartop": {
      const w = side + 2 * p;
      const bar = label ? labelH + gap : 0;
      const h = side + 2 * p + (label ? bar + p / 2 : 0);
      const top = s.frame === "bartop";
      const barY = top ? p : p + side + p / 2;
      const tileY = top && label ? p + bar + p / 2 : p;
      return {
        width: w, height: h, tile: { x: p, y: tileY, side },
        under: base(w, h, p, s.bg) + (label ? `<rect x="${f(p)}" y="${f(barY)}" width="${f(side)}" height="${f(bar)}" rx="${f(bar / 3)}" fill="${frameColor}"/>` : ""),
        over: text(w / 2, barY + bar / 2, side, inkOn(frameColor)),
      };
    }
    case "pill": {
      const w = side + 2 * p;
      const h = side + 2 * p + (label ? labelH / 2 : 0);
      const pillW = Math.min(w - 2 * p, Math.max(labelH * 3, label.length * labelH * 0.5 + labelH));
      const boxH = side + 2 * p;
      const pillY = boxH - labelH / 2;
      return {
        width: w, height: h, tile: { x: p, y: p, side },
        under: base(w, h, p, s.bg) + `<rect x="${f(thick / 2)}" y="${f(thick / 2)}" width="${f(w - thick)}" height="${f(boxH - thick)}" rx="${f(p)}" fill="none" stroke="${frameColor}" stroke-width="${f(thick)}"/>`
          + (label ? `<rect x="${f((w - pillW) / 2)}" y="${f(pillY)}" width="${f(pillW)}" height="${f(labelH)}" rx="${f(labelH / 2)}" fill="${frameColor}"/>` : ""),
        over: text(w / 2, pillY + labelH / 2, pillW, inkOn(frameColor)),
      };
    }
    case "corners": {
      const w = side + 2 * p;
      const h = side + 2 * p + (label ? labelH + gap : 0);
      const L = Math.max(3, n * 0.2);
      const b = thick * 1.4;
      const o = b / 2;
      const q = side + 2 * p;
      const corner = (x: number, y: number, dx: number, dy: number) => `<path d="M${f(x)} ${f(y + dy * L)}V${f(y)}H${f(x + dx * L)}" fill="none" stroke="${frameColor}" stroke-width="${f(b)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      return {
        width: w, height: h, tile: { x: p, y: p, side },
        under: base(w, h, 0, s.bg) + corner(o, o, 1, 1) + corner(q - o, o, -1, 1) + corner(o, q - o, 1, -1) + corner(q - o, q - o, -1, -1),
        over: text(w / 2, p + side + gap + labelH / 2 - 0.5, w - 2 * p, s.fg),
      };
    }
    case "badge": {
      const w = side + 2 * p;
      const head = label ? labelH + p / 2 : 0;
      const h = side + 2 * p + head;
      return {
        width: w, height: h, tile: { x: p, y: p + head, side },
        under: base(w, h, p, frameColor) + `<rect x="${f(p)}" y="${f(p + head)}" width="${f(side)}" height="${f(side)}" rx="${f(p / 2)}" fill="${s.bg}"/>`,
        over: text(w / 2, p + labelH / 2, side, inkOn(frameColor)),
      };
    }
    default:
      return { width: side, height: side, tile: { x: 0, y: 0, side }, under: "", over: "" };
  }
}

export interface SvgOptions {
  /** The picture for the middle of the code, as a data address (so it survives being drawn on a canvas). */
  logoHref?: string | null;
  /** Pixel width of the picture; the height follows. Defaults to the size in modules. */
  width?: number;
}

/** The whole styled code as an SVG document. */
export function qrSvg(modules: QrModules, style: QrStyle, opts: SvgOptions = {}): { svg: string; width: number; height: number } {
  const s = effectiveStyle(style);
  const hasLogo = !!opts.logoHref && s.logo !== "none";
  const paths = qrPaths(modules, s, hasLogo);
  const layout = frameLayout(paths.size, s);
  const { tile } = layout;
  const origin = tile.x + s.quiet;
  const originY = tile.y + s.quiet;
  const eyeFill = s.eyeFg || s.fg;
  let logo = "";
  if (hasLogo && paths.hole.side) {
    const { side, at } = paths.hole;
    const pad = 0.5;
    const x = origin + at;
    const y = originY + at;
    logo =
      `<rect x="${f(x - pad)}" y="${f(y - pad)}" width="${f(side + 2 * pad)}" height="${f(side + 2 * pad)}" rx="${f((side + 2 * pad) * 0.18)}" fill="${s.bg}"/>`
      + `<image href="${esc(opts.logoHref as string)}" x="${f(x)}" y="${f(y)}" width="${side}" height="${side}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  const px = opts.width ?? Math.round(layout.width);
  const pxH = Math.round((px * layout.height) / layout.width);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(layout.width)} ${f(layout.height)}" width="${px}" height="${pxH}" shape-rendering="geometricPrecision">`
    + (layout.under || `<rect width="${f(layout.width)}" height="${f(layout.height)}" fill="${s.bg}"/>`)
    + `<rect x="${f(tile.x)}" y="${f(tile.y)}" width="${f(tile.side)}" height="${f(tile.side)}" fill="${s.bg}"${s.frame === "badge" ? ` rx="${f(Math.max(2, paths.size * 0.05))}"` : ""}/>`
    + `<g transform="translate(${f(origin)} ${f(originY)})"><path d="${paths.dots}" fill="${s.fg}"/><path d="${paths.eyes}" fill="${eyeFill}" fill-rule="evenodd"/></g>`
    + logo
    + layout.over
    + `</svg>`;
  return { svg, width: px, height: pxH };
}
