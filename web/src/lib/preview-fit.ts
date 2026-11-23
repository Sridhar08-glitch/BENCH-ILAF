/**
 * The scale that makes a page of `contentW` x `contentH` fit a box of `boxW` x `boxH`.
 * It never enlarges the page (1 is the largest), never goes below a readable minimum,
 * and an empty or not yet measured box leaves the scale at 1.
 */
export function fitScale(boxW: number, boxH: number, contentW: number, contentH: number, min = 0.3): number {
  if (!(boxW > 0) || !(boxH > 0) || !(contentW > 0) || !(contentH > 0)) return 1;
  const s = Math.min(1, boxW / contentW, boxH / contentH);
  return Math.max(min, Math.round(s * 1000) / 1000);
}
