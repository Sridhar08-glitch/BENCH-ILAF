// The two text settings of a card design: the typeface of the name, title and contact lines (design.font) and
// their size (design.size). Pure data and rules, the same on the server and in the browser; the measuring that
// keeps an enlarged card from overlapping lives in ./textfit.
//
// How they reach the card: the faces are drawn by the generated engine with fixed sizes (cqw) and fixed fonts,
// so nothing in the 400 face sources changes. Instead the card wrapper gets classes and style variables
// (see textVars) and one small stylesheet (TEXT_CSS) that
//   - sets the font of the name, title, role/company and contact lines (`.n .t1 .t2 .co .cl .ln`), and
//   - scales those same blocks with the CSS `zoom` property by the factor in --ts.
// `zoom` was chosen over a font-size multiplier (the faces write their own cqw font sizes, so no variable can
// multiply them) and over `transform: scale` (that does not change the space a block takes, so a scaled name would
// still be laid out for its old size and leave gaps or overlap its neighbour). Where a browser does not know `zoom`
// the rule is ignored and the text simply stays at 100%.
import type { Design } from "@/lib/types";

export const FONT_FACE = "face";
export const TEXT_SIZE_MIN = 60;
export const TEXT_SIZE_MAX = 150;
export const TEXT_SIZE_DEFAULT = 100;

export type FontGroup = "sans" | "geometric" | "humanist" | "tech" | "serif" | "elegant" | "bookish" | "display" | "mono" | "hand" | "script" | "arabic";

export interface FontInfo {
  /** The value stored in design.font (the same list is kept in backend/ilaf/design.py). */
  key: string;
  /** The family as the self-hosted font stylesheet declares it. */
  family: string;
  /** Plain name of the typeface (not translated: it is a font name). */
  name: string;
  group: FontGroup;
  /** Arabic means the font is made for Arabic text (it also draws Latin letters). */
  script: "latin" | "arabic";
  /** The key of the Arabic font used for Arabic runs of the card when this font is chosen. */
  arabic: string;
  /** The generic family the browser falls back to. */
  generic: "sans-serif" | "serif" | "monospace" | "cursive";
}

export const FONTS: FontInfo[] = [
  { key: "poppins", family: "Poppins", name: "Poppins", group: "sans", script: "latin", arabic: "plex-arabic", generic: "sans-serif" },
  { key: "outfit", family: "Outfit", name: "Outfit", group: "geometric", script: "latin", arabic: "cairo", generic: "sans-serif" },
  { key: "manrope", family: "Manrope", name: "Manrope", group: "humanist", script: "latin", arabic: "plex-arabic", generic: "sans-serif" },
  { key: "space-grotesk", family: "Space Grotesk", name: "Space Grotesk", group: "tech", script: "latin", arabic: "tajawal", generic: "sans-serif" },
  { key: "playfair", family: "Playfair Display", name: "Playfair Display", group: "serif", script: "latin", arabic: "plex-arabic", generic: "serif" },
  { key: "cormorant", family: "Cormorant Garamond", name: "Cormorant Garamond", group: "elegant", script: "latin", arabic: "plex-arabic", generic: "serif" },
  { key: "lora", family: "Lora", name: "Lora", group: "bookish", script: "latin", arabic: "plex-arabic", generic: "serif" },
  { key: "oswald", family: "Oswald", name: "Oswald", group: "display", script: "latin", arabic: "cairo", generic: "sans-serif" },
  { key: "bebas", family: "Bebas Neue", name: "Bebas Neue", group: "display", script: "latin", arabic: "cairo", generic: "sans-serif" },
  { key: "jetbrains", family: "JetBrains Mono", name: "JetBrains Mono", group: "mono", script: "latin", arabic: "plex-arabic", generic: "monospace" },
  { key: "caveat", family: "Caveat", name: "Caveat", group: "hand", script: "latin", arabic: "cairo", generic: "cursive" },
  { key: "dancing", family: "Dancing Script", name: "Dancing Script", group: "script", script: "latin", arabic: "cairo", generic: "cursive" },
  { key: "plex-arabic", family: "IBM Plex Sans Arabic", name: "IBM Plex Sans Arabic", group: "arabic", script: "arabic", arabic: "plex-arabic", generic: "sans-serif" },
  { key: "cairo", family: "Cairo", name: "Cairo", group: "arabic", script: "arabic", arabic: "cairo", generic: "sans-serif" },
  { key: "tajawal", family: "Tajawal", name: "Tajawal", group: "arabic", script: "arabic", arabic: "tajawal", generic: "sans-serif" },
];

export const FONT_KEYS: string[] = [FONT_FACE, ...FONTS.map((f) => f.key)];

/** The families the self-hosted font stylesheet (scripts/copy-card-fonts.mjs) declares, as far as this module relies on them. */
export const HOSTED_FAMILIES = FONTS.filter((f) => f.key !== "plex-arabic").map((f) => f.family);

/**
 * The fixed text of a sample line in the picker, for each script. The picker shows the owner's own name when there
 * is one; these are only used for an empty name.
 */
export const SAMPLE_LATIN = "Your Name";
export const SAMPLE_ARABIC = "اسمك هنا";

const byKey = new Map(FONTS.map((f) => [f.key, f]));

export function fontInfo(key: string): FontInfo | null {
  return byKey.get(key) ?? null;
}

/** A known font key, or "face". */
export function normalizeFont(v: unknown): string {
  return typeof v === "string" && v !== FONT_FACE && byKey.has(v) ? v : FONT_FACE;
}

/** A whole number from 60 to 150, or the default (a number given as text is not accepted). */
export function normalizeSize(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= TEXT_SIZE_MIN && v <= TEXT_SIZE_MAX ? v : TEXT_SIZE_DEFAULT;
}

const PLEX = `var(--font-plex-ar, "IBM Plex Sans Arabic")`;
const SYSTEM_ARABIC = `"Segoe UI", Tahoma`;

/** The Arabic families of a font key, without a generic family at the end. */
function arabicFamilies(key: string): string {
  const family = byKey.get(fontInfo(key)?.arabic ?? "plex-arabic") ?? byKey.get("plex-arabic")!;
  // IBM Plex Sans Arabic is the app's own Arabic font (next/font in the root layout) and is reached through its variable.
  return family.key === "plex-arabic" ? `${PLEX}, ${SYSTEM_ARABIC}` : `"${family.family}", ${PLEX}, ${SYSTEM_ARABIC}`;
}

/** The CSS font stack for Arabic text of a card that uses this font key. */
export function arabicStack(key: string): string {
  return `${arabicFamilies(key)}, sans-serif`;
}

/** The CSS font stack of a font key for the card's Latin text; null for "face" and for unknown keys. */
export function fontStack(key: string): string | null {
  const f = byKey.get(key);
  if (!f) return null;
  if (f.key === "plex-arabic") return `${PLEX}, "Poppins", ${SYSTEM_ARABIC}, sans-serif`;
  return `"${f.family}", ${arabicFamilies(f.key)}, ${f.generic}`;
}

// ---- faces that keep their typeface

/**
 * Faces whose own typeface is part of their identity: terminal and code windows, pixel and 8-bit faces and the faces
 * that set their name in a typewriter font. They keep it, and the picker says so. Found by the font family their
 * face CSS gives to the face or to the name (Press Start 2P, JetBrains Mono, Space Mono); the library test checks
 * the list against the stylesheet.
 */
export const FONT_LOCKED_FACES: readonly number[] = [
  12, 19, 22, 32, 43, 56, 64, 81, 96, 103, 111, 115, 116, 149, 159, 221, 224, 265, 344, 365, 393, 400,
];
const locked = new Set(FONT_LOCKED_FACES);

export function isFontLocked(face: number): boolean {
  return locked.has(face);
}

// ---- how a design reaches the card

/** The scale the page may use before anything is measured: an enlarged size never applies without proof that it fits. */
export function safeScale(size: number): number {
  return Math.min(normalizeSize(size), TEXT_SIZE_DEFAULT) / 100;
}

/** Whether the font setting changes anything on this face. */
export function fontApplies(d: Pick<Design, "face" | "font">): boolean {
  return normalizeFont(d.font) !== FONT_FACE && !isFontLocked(d.face);
}

/** Classes for the card wrapper: "tx-font" when the font changes, "tx-size" when the size is not 100%. */
export function textClasses(d: Pick<Design, "face" | "font" | "size">): string {
  const out: string[] = [];
  if (fontApplies(d)) out.push("tx-font");
  if (normalizeSize(d.size) !== TEXT_SIZE_DEFAULT) out.push("tx-size");
  return out.join(" ");
}

/**
 * Style variables of the card wrapper. --tf and --tfa are the font stacks for Latin and Arabic text, --ts the scale
 * the page applies now (never above 1 until the browser has measured that the size fits) and --tsr the size that was
 * asked for, in percent, which the browser reads to measure.
 */
export function textVars(d: Pick<Design, "face" | "font" | "size">): Record<string, string> {
  const vars: Record<string, string> = {};
  if (fontApplies(d)) {
    const key = normalizeFont(d.font);
    vars["--tf"] = fontStack(key)!;
    vars["--tfa"] = arabicStack(key);
  }
  const size = normalizeSize(d.size);
  if (size !== TEXT_SIZE_DEFAULT) {
    vars["--ts"] = String(safeScale(size));
    vars["--tsr"] = String(size);
  }
  return vars;
}

const BLOCKS = ".n,.t1,.t2,.co,.cl,.ln";

/** The stylesheet of both settings. Scoped under `.cfl` like the library; sent only with a card that uses one of them. */
export const TEXT_CSS = `
.cfl.tx-font .face:not(.back) :is(${BLOCKS}),.cfl.tx-font .face:not(.back) :is(${BLOCKS}) b{font-family:var(--tf)!important}
.cfl.tx-font .face:not(.back) :is(${BLOCKS}) .ar{font-family:var(--tfa)!important}
.cfl.tx-size .face:not(.back) :is(${BLOCKS}):not(:is(${BLOCKS}) *){zoom:var(--ts,1)}
`.trim();

// ---- the fit rule (pure: boxes in, numbers out)

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What was measured on one face at one scale: the face, its text blocks and the things text must not touch. */
export interface Measured {
  face: Rect;
  texts: { id: string; rect: Rect }[];
  obstacles: { id: string; rect: Rect }[];
}

/** Smallest overlap, in pixels, that counts (anti-aliasing and line-height slack are not overlaps). */
const SLACK = 1;
/** Text may come this close to the right and bottom edge of the face (a share of its size), like the face fitting does. */
const EDGE = 0.03;

const overlaps = (a: Rect, b: Rect) => a.left < b.right - SLACK && a.right > b.left + SLACK && a.top < b.bottom - SLACK && a.bottom > b.top + SLACK;

/**
 * The problems of a measured face, as names: a text block that leaves the face ("n:edge"), two text blocks on top of
 * each other ("n+t1") or a text block on a picture or panel ("n>pw0"). Names are stable between scales, so the
 * problems the face already has at 100% can be told apart from the ones a larger size adds.
 */
export function problems(m: Measured): Set<string> {
  const out = new Set<string>();
  const w = m.face.right - m.face.left;
  const h = m.face.bottom - m.face.top;
  for (const t of m.texts) {
    const r = t.rect;
    if (r.right > m.face.right - w * EDGE || r.left < m.face.left || r.bottom > m.face.bottom - h * EDGE || r.top < m.face.top) out.add(`${t.id}:edge`);
    for (const o of m.obstacles) if (overlaps(r, o.rect)) out.add(`${t.id}>${o.id}`);
  }
  for (let i = 0; i < m.texts.length; i++) {
    for (let j = i + 1; j < m.texts.length; j++) {
      if (overlaps(m.texts[i].rect, m.texts[j].rect)) out.add(`${m.texts[i].id}+${m.texts[j].id}`);
    }
  }
  return out;
}

/** True when `now` has no problem that `baseline` (the face at 100%) did not already have. */
export function addsNoProblem(now: Set<string>, baseline: Set<string>): boolean {
  for (const p of now) if (!baseline.has(p)) return false;
  return true;
}

/**
 * The largest size from `requested` down to the minimum for which `fits` is true. Sizes are whole percents and
 * `fits` is expected to be true for small sizes and false for large ones, so a binary search finds the edge; the
 * result is then checked and stepped down, so a size that does not fit is never returned. When even the minimum
 * does not fit the minimum is returned (the legible floor; the face's own long-name fitting still runs after it).
 */
export function largestFit(fits: (size: number) => boolean, requested: number, floor = TEXT_SIZE_MIN): number {
  const top = Math.max(floor, Math.min(TEXT_SIZE_MAX, Math.round(requested)));
  if (fits(top)) return top;
  let lo = floor;
  let hi = top;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  let best = lo;
  while (best > floor && !fits(best)) best -= 1;
  return best;
}

/**
 * The size nearest to `requested` that fits, looking upward (a size below 100% can break a face whose text is placed by
 * its own offsets, because those scale with it). 100% is always the way out.
 */
export function nearestFit(fits: (size: number) => boolean, requested: number): number {
  for (let size = Math.max(TEXT_SIZE_MIN, Math.round(requested)); size < TEXT_SIZE_DEFAULT; size += 5) {
    if (fits(size)) return size;
  }
  return TEXT_SIZE_DEFAULT;
}

/** The face's own fitting did not shrink a name or title (font sizes in pixels) by more than rounding compared with 100%. */
export function keepsSize(now: number, atDefault: number): boolean {
  return atDefault <= 0 || now >= atDefault * 0.97;
}

/**
 * The size a card is drawn with. Unmeasured, an enlarged size is held at 100%. Measured, the requested size is used
 * where it fits and the largest one that fits otherwise; a size above 100% never goes below 100% (that is the face as
 * it is drawn, which its own fitting already looks after) and a size below 100% never goes below the minimum.
 */
export function appliedSize(requested: number, maxFit: number | null): number {
  const r = normalizeSize(requested);
  if (r <= TEXT_SIZE_DEFAULT) return r;
  if (maxFit === null) return TEXT_SIZE_DEFAULT;
  return Math.max(TEXT_SIZE_DEFAULT, Math.min(r, maxFit));
}
