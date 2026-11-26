// The card design library: 500 faces (401 to 500 are Design Pack 2), 77 page-style headers, 477 layouts below the card (401 to 477 go with the headers) and 400 opening
// animations, in number order. This module holds the names, tags and colours (small). The code that draws them is in ./render.
// Rebuild with `npm run build:library` and `npm run build:pack2` (see README).
import { BELOW_META, CSS_URL, FACE_META, INTRO_META, PAGES_CSS_URL, PALETTES, TOP_META } from "./generated/meta";
import { OLD_DETAILS, OLD_FACES, OLD_INTROS } from "./legacy";
import type { Design } from "@/lib/types";
import type { CompanyPalette } from "./company/colour";
import { pageVarsOf } from "./page";
import { FONT_FACE, TEXT_SIZE_DEFAULT, normalizeFont, normalizeSize } from "./text";

export const FACE_COUNT = FACE_META.length;
export const BELOW_COUNT = BELOW_META.length;
/** The page-style headers (design.top 1 to TOP_COUNT; 0 is the classic face card). */
export const TOP_COUNT = TOP_META.length;
/** Layouts 1 to 400 are Pack 1; 401 and up are the button sets of the page styles. */
export const PACK1_BELOW_COUNT = 400;
export const INTRO_COUNT = INTRO_META.length;
/** The colourways each face brings. */
export const COLOUR_COUNT = 4;
/** Design colour 4: the company palette instead of one of the face's own colourways. */
export const COMPANY_COLOUR = 4;

/** The stylesheet of every face, layout and opening. (The fonts they use are self-hosted: see scripts/copy-card-fonts.mjs.) */
export { CSS_URL, PAGES_CSS_URL };

export interface Palette {
  name: string;
  bg: string;
  bg2: string;
  fg: string;
  acc: string;
  on: string;
}

export interface FaceInfo {
  name: string;
  tags: string[];
  /** The four colourways made for this face. */
  palettes: Palette[];
}

const clampTo = (n: number, min: number, max: number, fallback: number) => (Number.isInteger(n) && n >= min && n <= max ? n : fallback);

export function faceInfo(n: number): FaceInfo {
  const f = FACE_META[clampTo(n, 1, FACE_COUNT, 1) - 1];
  return { name: f.n, tags: f.tags, palettes: f.p.map((i) => ({ ...PALETTES[i] })) };
}

export function belowInfo(n: number): { name: string; description: string } {
  const b = BELOW_META[clampTo(n, 1, BELOW_COUNT, 1) - 1];
  return { name: b.n, description: b.d };
}

/** 0 is "no animation". */
export function introInfo(n: number): { key: string; name: string } {
  if (n === 0) return { key: "none", name: "No animation" };
  const [key, name] = INTRO_META[clampTo(n, 1, INTRO_COUNT, 1) - 1];
  return { key, name };
}

export interface ResolvedColours extends Palette {
  /** Colours of the page the card sits on, of the buttons below it and of the card edge (--pgbg, --pgfg, --pacc, --pon, --pgline, --pgsh). */
  pageVars: Record<string, string>;
  /** Colours of the card itself (--cbg, --cbg2, --cfg, --cacc, --con). */
  cardVars: Record<string, string>;
}

/** Colour 4 only means something when the company has a palette; without one the card shows colourway 0. */
export function effectiveColour(colour: number, palette?: CompanyPalette | null): number {
  return colour === COMPANY_COLOUR && !palette ? 0 : colour;
}

/** The five colours of a design (from its face and colourway, or the company palette for colour 4) and the style variables they become. */
export function resolveColours(design: Pick<Design, "face" | "colour">, palette?: CompanyPalette | null): ResolvedColours {
  const face = FACE_META[clampTo(design.face, 1, FACE_COUNT, 1) - 1];
  const colour = effectiveColour(design.colour, palette);
  const p: Palette = colour === COMPANY_COLOUR && palette ? { name: "Brand", ...palette } : PALETTES[face.p[clampTo(colour, 0, COLOUR_COUNT - 1, 0)]];
  const { name, bg, bg2, fg, acc, on } = p;
  return {
    name, bg, bg2, fg, acc, on,
    pageVars: pageVarsOf(p),
    cardVars: { "--cbg": bg, "--cbg2": bg2, "--cfg": fg, "--cacc": acc, "--con": on },
  };
}

/** A new card: classic face in the BENCH colours, the list below it, fade-up opening. */
export function defaultDesign(): Design {
  return { face: 1, custom_face: null, colour: 0, top: 0, below: 1, intro: 1, font: FONT_FACE, size: TEXT_SIZE_DEFAULT, photo: true, brand_colors: false, foot: true };
}

/** A whole number in range, or null. A number given as text is not accepted. */
function whole(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

/** The position (starting at 1) of an old name in its list, or null. */
function position(v: unknown, list: string[]): number | null {
  const i = typeof v === "string" ? list.indexOf(v) : -1;
  return i >= 0 ? i + 1 : null;
}

/**
 * Turn anything the API sends into a complete, valid design. A design in the old named format is converted
 * the way the backend does (a name becomes its position, colours become colourway 0, intro "none" becomes 0).
 * Missing or invalid values fall back to the defaults, so a card never breaks the page.
 */
export function normalizeDesign(raw: unknown): Design {
  const d = defaultDesign();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const intro = r.intro === "none" ? 0 : (whole(r.intro, 0, INTRO_COUNT) ?? position(r.intro, OLD_INTROS));
  return {
    face: whole(r.face, 1, FACE_COUNT) ?? position(r.face, OLD_FACES) ?? d.face,
    custom_face: whole(r.custom_face, 1, 2147483647),
    colour: whole(r.colour, 0, COMPANY_COLOUR) ?? d.colour,
    top: whole(r.top, 0, TOP_COUNT) ?? d.top,
    below: whole(r.below, 1, BELOW_COUNT) ?? position(r.details, OLD_DETAILS) ?? d.below,
    intro: intro ?? d.intro,
    font: normalizeFont(r.font),
    size: normalizeSize(r.size),
    photo: typeof r.photo === "boolean" ? r.photo : d.photo,
    brand_colors: typeof r.brand_colors === "boolean" ? r.brand_colors : d.brand_colors,
    foot: typeof r.foot === "boolean" ? r.foot : d.foot,
  };
}

export interface TopInfo {
  name: string;
  description: string;
  /** The group of the header: an app pattern (Popl, Blinq, HiHello, Wave, Mobilo, Linq, Dot, Arabic) or a design family (Editorial, Objects, Digital, Gulf, Creative). */
  style: string;
  /** The header shows the chosen face card inside its card block. */
  face: boolean;
  /** The header is drawn right to left. */
  rtl: boolean;
  /** Name and description in Arabic (the hand-made styles 28 and up; the first 27 have English names only). */
  ar: [string, string] | null;
}

/** A page-style header by number (1 to TOP_COUNT). */
export function topInfo(n: number): TopInfo {
  const t = TOP_META[clampTo(n, 1, TOP_COUNT, 1) - 1];
  return { name: t.n, description: t.d, style: t.s, face: t.b, rtl: t.rtl, ar: (t as { a?: [string, string] }).a ?? null };
}

/** The layout below the card that belongs to a header (its own button set). */
export const belowOfTop = (top: number): number => PACK1_BELOW_COUNT + top;
