import { describe, expect, it } from "vitest";
import { DEFAULT_PLOT, barBox, barHeight, innerSize, linePath, niceTop, share, ticks, xOfPoint, yOfValue } from "./charts";

describe("chart scale", () => {
  it("picks a round top above the data", () => {
    expect(niceTop(0)).toBe(1);
    expect(niceTop(7)).toBe(10);
    expect(niceTop(23)).toBe(25);
    expect(niceTop(48)).toBe(50);
    expect(niceTop(101)).toBe(200);
    expect(niceTop(2400)).toBe(2500);
  });
  it("makes evenly spaced ticks from zero", () => {
    expect(ticks(100, 4)).toEqual([0, 25, 50, 75, 100]);
  });
  it("maps zero to the baseline and the top to the top edge", () => {
    const p = DEFAULT_PLOT;
    expect(yOfValue(0, 50, p)).toBe(p.top + innerSize(p).h);
    expect(yOfValue(50, 50, p)).toBe(p.top);
    expect(yOfValue(500, 50, p)).toBe(p.top);
    expect(yOfValue(25, 50, p)).toBeCloseTo(p.top + innerSize(p).h / 2);
  });
  it("spreads points across the width", () => {
    const p = DEFAULT_PLOT;
    expect(xOfPoint(0, 5, p)).toBe(p.left);
    expect(xOfPoint(4, 5, p)).toBe(p.width - p.right);
    expect(xOfPoint(0, 1, p)).toBe(p.left + innerSize(p).w / 2);
  });
  it("draws a line that breaks at missing values", () => {
    const d = linePath([1, 2, null, 4], 4, DEFAULT_PLOT);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/L/g)).toHaveLength(1);
  });
  it("sizes bars to scale and keeps them inside their slot", () => {
    const p = DEFAULT_PLOT;
    const a = barBox(0, 4, p);
    const b = barBox(1, 4, p);
    expect(a.x).toBeGreaterThanOrEqual(p.left);
    expect(a.x + a.w).toBeLessThan(b.x);
    expect(barHeight(0, 10, p)).toBe(0);
    expect(barHeight(10, 10, p)).toBeCloseTo(innerSize(p).h);
    expect(barHeight(5, 10, p)).toBeCloseTo(innerSize(p).h / 2);
  });
  it("computes shares", () => {
    expect(share(1, 3)).toBe(33);
    expect(share(0, 0)).toBe(0);
  });
});
