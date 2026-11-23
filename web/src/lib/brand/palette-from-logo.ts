// Suggest brand colours from a logo. The pixels of a small copy of the logo are grouped into a few colours (median cut),
// transparent, near-white and near-black pixels are ignored, and up to three palettes (a primary and an accent) are made
// that are saturated enough and far enough apart. Every candidate goes through the same palette maths as the colour
// pickers (derivePalette), so the readability guarantees are the same. Pure functions: they take RGBA pixel data, so the
// tests need no browser; only `readLogoPixels` touches a canvas.
import { cr, derivePalette, fromHsl, normHex, r2h, toHsl, type BrandMode, type DerivedPalette } from "@/lib/library/company/colour";

export interface RgbaImage {
  /** RGBA, four numbers per pixel. */
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export interface Swatch {
  hex: string;
  /** How many pixels the colour stands for. */
  count: number;
  /** Hue 0-360, saturation and lightness 0-1. */
  hsl: [number, number, number];
}

export interface PaletteCandidate {
  primary: string;
  accent: string;
  mode: BrandMode;
  /** The card palette made from the two colours, with its readability ratios. */
  derived: DerivedPalette;
}

type Weighted = { rgb: [number, number, number]; count: number };

/** Pixels worth looking at: opaque enough, and neither almost white nor almost black (a logo's own background and outline). */
export function usablePixels(img: RgbaImage): Weighted[] {
  const buckets = new Map<number, Weighted>();
  const { data } = img;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    if (lo > 238) continue; // near white
    if (hi < 28) continue; // near black
    // Group colours that differ by a few steps so the count is the area a colour covers, not its noise.
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const at = buckets.get(key);
    if (at) {
      at.count += 1;
      at.rgb = [at.rgb[0] + (r - at.rgb[0]) / at.count, at.rgb[1] + (g - at.rgb[1]) / at.count, at.rgb[2] + (b - at.rgb[2]) / at.count];
    } else buckets.set(key, { rgb: [r, g, b], count: 1 });
  }
  return [...buckets.values()];
}

/** Median cut: split the colours into `boxes` groups along their widest channel and return each group's weighted average. */
export function medianCut(colours: Weighted[], boxes: number): Weighted[] {
  if (colours.length === 0) return [];
  let groups: Weighted[][] = [colours];
  while (groups.length < boxes) {
    // Split the group with the widest spread (and more than one colour).
    let best = -1;
    let bestRange = 0;
    let bestChannel = 0;
    groups.forEach((g, gi) => {
      if (g.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        const values = g.map((c) => c.rgb[ch]);
        const range = Math.max(...values) - Math.min(...values);
        if (range > bestRange) {
          best = gi;
          bestRange = range;
          bestChannel = ch;
        }
      }
    });
    if (best < 0 || bestRange < 8) break;
    const g = [...groups[best]].sort((a, b) => a.rgb[bestChannel] - b.rgb[bestChannel]);
    const total = g.reduce((n, c) => n + c.count, 0);
    let run = 0;
    let cut = 1;
    for (let i = 0; i < g.length - 1; i++) {
      run += g[i].count;
      cut = i + 1;
      if (run >= total / 2) break;
    }
    groups = [...groups.slice(0, best), g.slice(0, cut), g.slice(cut), ...groups.slice(best + 1)];
  }
  return groups.map((g) => {
    const count = g.reduce((n, c) => n + c.count, 0);
    const avg = (ch: number) => g.reduce((n, c) => n + c.rgb[ch] * c.count, 0) / count;
    return { rgb: [avg(0), avg(1), avg(2)] as [number, number, number], count };
  });
}

/** The main colours of a logo, most covering first. Empty when the logo has no usable pixels (all white, black or clear). */
export function logoSwatches(img: RgbaImage, boxes = 6): Swatch[] {
  const cut = medianCut(usablePixels(img), boxes);
  return cut
    .map((c) => {
      const hex = r2h(c.rgb);
      return { hex: hex.toLowerCase(), count: c.count, hsl: toHsl(hex) };
    })
    .sort((a, b) => b.count - a.count);
}

/** How alive a colour is: grey and washed-out colours are poor brand colours. */
const MIN_SATURATION = 0.28;
/** Primary and accent must differ at least this much in brightness, or the accent vanishes next to the primary. */
const MIN_CONTRAST = 1.5;

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** A colour with at least the minimum saturation (kept the same hue) and a middle lightness a brand colour can live with. */
export function livelier(hex: string): string {
  const [h, s, l] = toHsl(hex);
  return fromHsl([h, Math.max(s, 0.5), Math.min(0.62, Math.max(0.28, l))]).toLowerCase();
}

/** Move an accent's lightness in small steps until it stands out from the primary. */
function apart(primary: string, accent: string): string {
  if (cr(primary, accent) >= MIN_CONTRAST) return accent;
  const [h, s, l] = toHsl(accent);
  const dir = l >= 0.5 ? -1 : 1;
  for (let step = 1; step <= 40; step++) {
    const next = fromHsl([h, s, Math.min(0.95, Math.max(0.05, l + dir * step * 0.02))]).toLowerCase();
    if (cr(primary, next) >= MIN_CONTRAST) return next;
  }
  // The other direction, in case the first one ran into the end of the scale.
  for (let step = 1; step <= 40; step++) {
    const next = fromHsl([h, s, Math.min(0.95, Math.max(0.05, l - dir * step * 0.02))]).toLowerCase();
    if (cr(primary, next) >= MIN_CONTRAST) return next;
  }
  return accent;
}

/** An accent that goes with a primary when the logo has only one colour: the opposite side of the colour wheel. */
export function complement(primary: string): string {
  const [h, s, l] = toHsl(primary);
  return fromHsl([(h + 180) % 360, Math.max(s, 0.55), Math.min(0.6, Math.max(0.4, l))]).toLowerCase();
}

function candidate(primary: string, accent: string, mode: BrandMode): PaletteCandidate {
  const p = normHex(primary).toLowerCase();
  const a = normHex(apart(p, normHex(accent).toLowerCase())).toLowerCase();
  return { primary: p, accent: a, mode, derived: derivePalette(p, a, mode) };
}

/**
 * Up to three palettes from a logo's colours:
 *   1. the biggest lively colour as primary, the most different lively colour as accent (or its opposite);
 *   2. the same two swapped, on a light card;
 *   3. the primary with its opposite as accent, on a dark card.
 * No usable colour at all gives none: the owner then picks by hand.
 */
export function paletteCandidates(img: RgbaImage): PaletteCandidate[] {
  const swatches = logoSwatches(img);
  if (swatches.length === 0) return [];
  const lively = swatches.filter((s) => s.hsl[1] >= MIN_SATURATION);
  const pool = lively.length > 0 ? lively : swatches.map((s) => ({ ...s, hex: livelier(s.hex), hsl: toHsl(livelier(s.hex)) }));
  const primary = pool[0];
  // The accent: the other colour furthest round the colour wheel (and not nearly the same brightness).
  const others = pool.slice(1).filter((s) => hueGap(s.hsl[0], primary.hsl[0]) >= 25 || Math.abs(s.hsl[2] - primary.hsl[2]) >= 0.25);
  const accentSwatch = others.sort((a, b) => hueGap(b.hsl[0], primary.hsl[0]) * b.hsl[1] - hueGap(a.hsl[0], primary.hsl[0]) * a.hsl[1])[0];
  const accent = accentSwatch ? accentSwatch.hex : complement(primary.hex);
  const out: PaletteCandidate[] = [candidate(primary.hex, accent, "brand")];
  out.push(candidate(accent, primary.hex, "light"));
  out.push(candidate(primary.hex, complement(primary.hex), "dark"));
  // Drop a candidate that repeats an earlier one.
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = `${c.primary}|${c.accent}|${c.mode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A readable one-line check used by the tests and the screen: both card texts keep their contrast. */
export function candidateIsReadable(c: PaletteCandidate): boolean {
  return c.derived.ratios.text >= 4.5 && c.derived.ratios.on >= 3;
}

// ---------------------------------------------------------------- the browser part

/** The pixels of a logo drawn small on a canvas (at most `max` px on its long side). Rejects when the image cannot be read. */
export function readLogoPixels(url: string, max = 64): Promise<RgbaImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight, 1));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return reject(new Error("no canvas"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve({ data: ctx.getImageData(0, 0, width, height).data, width, height });
      } catch (e) {
        reject(e instanceof Error ? e : new Error("unreadable"));
      }
    };
    img.onerror = () => reject(new Error("load"));
    img.src = url;
  });
}
