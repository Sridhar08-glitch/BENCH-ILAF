// The numbers behind the staff dashboard charts (drawn as plain SVG, no chart library): a "nice" top value, tick values
// and the pixel position of each point. Charts always start at zero, so bars and lines are drawn to scale.
export function niceTop(max: number): number {
  const v = Math.max(1, max);
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * p;
}

export function ticks(top: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (top * i) / count);
}

export interface Plot { width: number; height: number; left: number; right: number; top: number; bottom: number }

export const DEFAULT_PLOT: Plot = { width: 640, height: 220, left: 44, right: 12, top: 16, bottom: 26 };

export function innerSize(p: Plot): { w: number; h: number } {
  return { w: p.width - p.left - p.right, h: p.height - p.top - p.bottom };
}

/** Pixel x of point `i` of `n` on a line chart. */
export function xOfPoint(i: number, n: number, p: Plot): number {
  const { w } = innerSize(p);
  return p.left + (n < 2 ? w / 2 : (w * i) / (n - 1));
}

/** Pixel y of a value on a chart whose top is `top`. */
export function yOfValue(v: number, top: number, p: Plot): number {
  const { h } = innerSize(p);
  return p.top + h - (h * Math.min(Math.max(v, 0), top)) / top;
}

/** The "d" attribute of a polyline through the values (null values break the line). */
export function linePath(values: (number | null)[], top: number, p: Plot): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${xOfPoint(i, values.length, p).toFixed(1)} ${yOfValue(v, top, p).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** Left edge and width of bar `i` of `n`, with a gap between bars. */
export function barBox(i: number, n: number, p: Plot, gap = 0.3): { x: number; w: number } {
  const { w } = innerSize(p);
  const slot = w / n;
  const bw = slot * (1 - gap);
  return { x: p.left + slot * i + (slot - bw) / 2, w: bw };
}

/** Height in pixels of a bar for `v`. */
export function barHeight(v: number, top: number, p: Plot): number {
  return innerSize(p).h - (yOfValue(v, top, p) - p.top);
}

/** Percent of `part` in `whole` rounded to a whole number (0 when the whole is 0). */
export function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((100 * part) / whole) : 0;
}
