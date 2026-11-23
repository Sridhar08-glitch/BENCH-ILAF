// Pure geometry for the page tours: where the highlight box and the tip bubble go. Everything is measured by the
// caller (getBoundingClientRect) and passed in, so this is easy to test and never touches the page.

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}
export type Placement = "bottom" | "top" | "end" | "start" | "center";

export interface TipPosition {
  top: number;
  left: number;
  placement: Placement;
}

const MARGIN = 12;

/** The highlight box: the target grown by `pad`, kept inside the viewport. */
export function spotlight(target: Box, viewport: Size, pad = 6): Box {
  const top = Math.max(0, target.top - pad);
  const left = Math.max(0, target.left - pad);
  const right = Math.min(viewport.width, target.left + target.width + pad);
  const bottom = Math.min(viewport.height, target.top + target.height + pad);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, Math.max(min, max)));
}

/**
 * Where to put a bubble of `tip` size beside `target`. It prefers below, then above, then the reading-end side, then the
 * other side; if nothing fits, or there is no target, it is centred. `rtl` swaps which side counts as the end.
 * `left` is always a physical coordinate (the caller positions with left/top).
 */
export function placeTip(target: Box | null, tip: Size, viewport: Size, rtl = false, gap = 12): TipPosition {
  const centre: TipPosition = {
    top: clamp((viewport.height - tip.height) / 2, MARGIN, viewport.height - tip.height - MARGIN),
    left: clamp((viewport.width - tip.width) / 2, MARGIN, viewport.width - tip.width - MARGIN),
    placement: "center",
  };
  if (!target || target.width <= 0 || target.height <= 0) return centre;

  const centredX = clamp(target.left + target.width / 2 - tip.width / 2, MARGIN, viewport.width - tip.width - MARGIN);
  const centredY = clamp(target.top + target.height / 2 - tip.height / 2, MARGIN, viewport.height - tip.height - MARGIN);
  const below = target.top + target.height + gap;
  const above = target.top - gap - tip.height;
  const rightSide = target.left + target.width + gap;
  const leftSide = target.left - gap - tip.width;

  const fitsBelow = below + tip.height + MARGIN <= viewport.height;
  const fitsAbove = above >= MARGIN;
  const fitsRight = rightSide + tip.width + MARGIN <= viewport.width;
  const fitsLeft = leftSide >= MARGIN;

  const endFirst: ["end" | "start", boolean, number][] = rtl
    ? [["end", fitsLeft, leftSide], ["start", fitsRight, rightSide]]
    : [["end", fitsRight, rightSide], ["start", fitsLeft, leftSide]];

  if (fitsBelow) return { top: below, left: centredX, placement: "bottom" };
  if (fitsAbove) return { top: above, left: centredX, placement: "top" };
  for (const [placement, fits, left] of endFirst) if (fits) return { top: centredY, left, placement };
  // A target as large as the screen (or a tiny screen): float the bubble at the bottom of the view.
  return { ...centre, top: clamp(viewport.height - tip.height - MARGIN, MARGIN, viewport.height) };
}

/** True when the target is fully or partly inside the viewport (so no scrolling is needed). */
export function isVisible(target: Box, viewport: Size): boolean {
  return target.top + target.height > 0 && target.top < viewport.height && target.left + target.width > 0 && target.left < viewport.width;
}

/** Where to scroll so a target sits comfortably in view (a third from the top), or null when it already is. */
export function scrollTarget(target: Box, viewport: Size, scrollY: number): number | null {
  const inside = target.top >= MARGIN && target.top + target.height <= viewport.height - MARGIN;
  if (inside) return null;
  return Math.max(0, Math.round(scrollY + target.top - viewport.height / 3));
}

/** The next step index, stepping over steps whose target is missing; null when there is none left. */
export function nextIndex(from: number, dir: 1 | -1, present: boolean[]): number | null {
  for (let i = from + dir; i >= 0 && i < present.length; i += dir) if (present[i]) return i;
  return null;
}
