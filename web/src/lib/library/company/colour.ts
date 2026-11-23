// Colour maths for company brands: the five card colours are made from two brand colours, and every text colour is
// kept readable (WCAG contrast). Pure functions, the same on the server and in the browser.

export type Rgb = [number, number, number];
export type BrandMode = "brand" | "light" | "dark";

/** The five colours of a company card, all "#rrggbb". */
export interface CompanyPalette {
  bg: string;
  bg2: string;
  fg: string;
  acc: string;
  on: string;
}

export const WHITE = "#FFFFFF";
export const INK = "#0A0A0A";
const BLACK = "#000000";

/** White or pure black, whichever reads better on a colour (always at least 4.5 : 1). */
const bestPlain = (bg: string) => (cr(WHITE, bg) >= cr(BLACK, bg) ? WHITE : BLACK);

export function h2r(h: string): Rgb {
  let s = String(h).replace("#", "");
  if (s.length === 3) s = s.replace(/./g, "$&$&");
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
}

export function r2h(r: number[]): string {
  return "#" + r.map((v) => {
    const c = Math.max(0, Math.min(255, Math.round(v)));
    return (c < 16 ? "0" : "") + c.toString(16);
  }).join("").toUpperCase();
}

/** Relative luminance (WCAG). */
export function rl(h: string): number {
  const c = h2r(h).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Contrast ratio between two colours (1 to 21). */
export function cr(a: string, b: string): number {
  let x = rl(a);
  let y = rl(b);
  if (x < y) [x, y] = [y, x];
  return (x + 0.05) / (y + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const x = h2r(a);
  const y = h2r(b);
  return r2h([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export function toHsl(h: string): [number, number, number] {
  const c = h2r(h);
  const r = c[0] / 255;
  const g = c[1] / 255;
  const b = c[2] / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let s = 0;
  let hh = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) hh = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60;
  }
  return [hh, s, l];
}

export function fromHsl(a: [number, number, number]): string {
  const h = a[0] / 360;
  const s = a[1];
  const l = a[2];
  const f = (p: number, q: number, tt: number) => {
    let t = tt;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (!s) return r2h([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return r2h([f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255]);
}

/** "#abc", "abc", "#aabbcc" or "aabbcc". */
export function okHex(v: unknown): boolean {
  return typeof v === "string" && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
}

/** "#AABBCC" from any accepted form. */
export function normHex(v: string): string {
  let s = String(v).trim();
  if (s.charAt(0) !== "#") s = "#" + s;
  if (s.length === 4) s = "#" + s.slice(1).replace(/[0-9a-f]/gi, "$&$&");
  return s.toUpperCase();
}

/** Keep an accent readable on a background by moving only its lightness, in small steps. */
function ensure(c: string, bg: string, min: number, info: { adjusted: boolean }): string {
  if (cr(c, bg) >= min) return c;
  const h = toHsl(c);
  const dir = cr(WHITE, bg) >= cr(INK, bg) ? 1 : -1;
  for (let k = 0; k < 50; k++) {
    h[2] = Math.max(0, Math.min(1, h[2] + dir * 0.02));
    const c2 = fromHsl(h);
    if (cr(c2, bg) >= min) {
      info.adjusted = true;
      return c2;
    }
  }
  info.adjusted = true;
  return bestPlain(bg);
}

export interface DerivedPalette {
  pal: CompanyPalette;
  /** The accent had to be moved to stay readable. */
  adjusted: boolean;
  mode: BrandMode;
  ratios: { text: number; acc: number; on: number };
  /** Primary and accent are very close to each other. */
  close: boolean;
}

/** The whole card palette from two brand colours. Text is at least 4.5 : 1 on both backgrounds, text on the accent too. */
export function derivePalette(prim: string, acc: string, mode: BrandMode): DerivedPalette {
  const info = { adjusted: false };
  const hp = toHsl(prim);
  let bg: string;
  if (mode === "light") bg = mix(prim, WHITE, 0.92);
  else if (mode === "dark") bg = fromHsl([hp[0], Math.min(hp[1], 0.6), Math.min(0.15, Math.max(0.08, hp[2] * 0.35))]);
  else bg = prim;
  let fg = cr(WHITE, bg) >= 4.5 ? mix(WHITE, bg, 0.03) : mix(INK, bg, 0.08);
  if (cr(fg, bg) < 4.5) fg = bestPlain(bg);
  const a = ensure(acc, bg, 4.5, info);
  let bg2: string;
  if (mode === "brand") bg2 = mix(bg, fg, 0.12);
  else if (mode === "light") bg2 = mix(bg, prim, 0.2);
  else bg2 = mix(bg, prim, 0.3);
  if (cr(fg, bg2) < 4.5) bg2 = mix(bg, fg, 0.06);
  // a colour in the middle of the range may leave no room for a second background: it then equals the first
  if (cr(fg, bg2) < 4.5) bg2 = bg;
  const on = cr(bg, a) >= 4.5 ? bg : cr(WHITE, a) >= cr(INK, a) ? WHITE : INK;
  const lower = (c: string) => c.toLowerCase();
  return {
    pal: { bg: lower(bg), bg2: lower(bg2), fg: lower(fg), acc: lower(a), on: lower(on) },
    adjusted: info.adjusted,
    mode,
    ratios: { text: cr(fg, bg), acc: cr(a, bg), on: cr(on, a) },
    close: cr(prim, acc) < 1.25,
  };
}

/** The server's own readable check (contract): text on both backgrounds 4.5, text on the accent 3.0. */
export function paletteProblem(p: CompanyPalette): string | null {
  if (cr(p.fg, p.bg) < 4.5) return "The text colour is hard to read on the card colour.";
  if (cr(p.fg, p.bg2) < 4.5) return "The text colour is hard to read on the second card colour.";
  if (cr(p.on, p.acc) < 3) return "The text on buttons is hard to read on the accent colour.";
  return null;
}

const HEX6 = /^#[0-9a-f]{6}$/i;

/** A palette from the API, or null when it is missing or any colour is not a six-digit hex. */
export function asPalette(v: unknown): CompanyPalette | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const keys = ["bg", "bg2", "fg", "acc", "on"] as const;
  const out: Record<string, string> = {};
  for (const k of keys) {
    const c = r[k];
    if (typeof c !== "string" || !HEX6.test(c)) return null;
    out[k] = c.toLowerCase();
  }
  return out as unknown as CompanyPalette;
}

export const rgba = (h: string, a: number) => {
  const c = h2r(h);
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
};
