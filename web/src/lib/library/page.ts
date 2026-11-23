// The colours of the page behind the card and of the buttons below it. The page is drawn so the card stands out from
// it: a dark card sits on a lighter tint of itself, a light card on a darker tint, and a mid-tone or vivid card on a
// deep neutral or a pale neutral. Text and button colours are then moved only as far as needed to stay readable.
// Pure functions, the same on the server and in the browser.
import { WHITE, cr, fromHsl, mix, normHex, rl, rgba, toHsl } from "./company/colour";

export interface PageSource {
  bg: string;
  fg: string;
  acc: string;
  on: string;
}

export interface PageColours {
  /** The page behind the card. */
  bg: string;
  /** Text on the page. */
  fg: string;
  /** Button colour below the card. */
  acc: string;
  /** Text and icons on a button. */
  on: string;
  /** Hairline round the card, derived from the page. */
  line: string;
  /** Soft shadow colour under the card. */
  shadow: string;
}

const DEEP = "#14161B";
const PALE = "#F1F2F4";
const GLYPH_INK = "#0F172A";

/** The least luminance ratio between a card and the page it sits on. */
export const MIN_STAND_OUT = 1.5;
/** A light card on a darker tint cannot reach MIN_STAND_OUT (both are bright); the card edge carries the rest. */
const MIN_STAND_OUT_LIGHT = 1.2;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Move only the lightness of a colour, in steps, until it differs enough from the card colour. */
function shifted(card: string, dir: 1 | -1, start: number, max: number, min: number, satScale: number): string {
  const [h, s, l] = toHsl(card);
  let out = card;
  for (let d = start; d <= max + 1e-9; d += 0.01) {
    out = fromHsl([h, clamp01(s * satScale), clamp01(l + dir * d)]);
    if (cr(out, card) >= min) return out;
  }
  return out;
}

/** A vivid colour (orange, yellow, bright blue) as opposed to a dark, light or grey one. */
function isVivid(c: string): boolean {
  const [, s, l] = toHsl(c);
  return s * (1 - Math.abs(2 * l - 1)) >= 0.45 && l >= 0.25 && l <= 0.85;
}

/** The page colour for a card background. */
export function pageBackground(cardBg: string): string {
  const card = normHex(cardBg);
  const lum = rl(card);
  const mid = isVivid(card) || (lum >= 0.18 && lum < 0.5);
  if (mid) {
    // A neutral far from the card in brightness: pale for the darker half of the middle, deep ink for the lighter half.
    const pale = mix(PALE, card, 0.05);
    const deep = mix(DEEP, card, 0.05);
    const order = lum < 0.4 ? [pale, deep] : [deep, pale];
    return order.find((c) => cr(c, card) >= MIN_STAND_OUT) ?? (cr(pale, card) >= cr(deep, card) ? pale : deep);
  }
  if (lum < 0.18) return shifted(card, 1, 0.16, 0.34, MIN_STAND_OUT, 0.85);
  return shifted(card, -1, 0.1, 0.2, MIN_STAND_OUT_LIGHT, 0.97);
}

/** White or deep ink, whichever reads better on a colour. */
export function bestText(bg: string): string {
  return cr(WHITE, bg) >= cr(GLYPH_INK, bg) ? WHITE : GLYPH_INK;
}

/** Keep a colour readable on a background by moving only its lightness. */
function atLeast(c: string, bg: string, min: number): string {
  if (cr(c, bg) >= min) return c;
  const [h, s, l] = toHsl(c);
  const dir = cr(WHITE, bg) >= cr(GLYPH_INK, bg) ? 1 : -1;
  for (let d = 0.02; d <= 1; d += 0.02) {
    const out = fromHsl([h, s, clamp01(l + dir * d)]);
    if (cr(out, bg) >= min) return out;
  }
  return bestText(bg);
}

/** The page colours for one card colourway. */
export function pageColours(p: PageSource): PageColours {
  const bg = pageBackground(p.bg);
  const fgWanted = normHex(p.fg);
  const fg = cr(fgWanted, bg) >= 4.5 ? fgWanted : atLeast(mix(bestText(bg), bg, 0.04), bg, 4.5);
  const acc0 = normHex(p.acc);
  // a little above 3 : 1, so the colour still holds on the slightly darker or lighter tiles the layouts draw on the page
  // When the card colour itself is a vivid brand colour that shows on the page (a yellow card on a deep page), it takes
  // over as the button colour before the accent is moved.
  const cardBg = normHex(p.bg);
  const acc = cr(acc0, bg) >= 3.4 ? acc0 : isVivid(cardBg) && cr(cardBg, bg) >= 3.4 ? cardBg : atLeast(acc0, bg, 3.4);
  const on0 = normHex(p.on);
  const on = cr(on0, acc) >= 3 && acc === acc0 ? on0 : bestText(acc);
  const dark = rl(bg) < 0.4;
  const line = mix(bg, fg, dark ? 0.2 : 0.16);
  return { bg, fg, acc, on, line, shadow: rgba(mix(bg, "#000000", dark ? 0.75 : 0.6), dark ? 0.6 : 0.34) };
}

/** The style variables of a page (the four button and text colours, plus the card edge). */
export function pageVarsOf(p: PageSource): Record<string, string> {
  const c = pageColours(p);
  return { "--pgbg": c.bg, "--pgfg": c.fg, "--pacc": c.acc, "--pon": c.on, "--pgline": c.line, "--pgsh": c.shadow };
}
