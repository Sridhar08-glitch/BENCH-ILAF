import { describe, expect, it } from "vitest";
import { fitScale } from "./preview-fit";

describe("fitScale", () => {
  it("shrinks a tall page to the height of the panel and never enlarges it", () => {
    expect(fitScale(420, 560, 408, 800)).toBe(0.7);
    expect(fitScale(420, 1200, 408, 800)).toBe(1);
  });
  it("also fits the width", () => {
    expect(fitScale(204, 2000, 408, 800)).toBe(0.5);
  });
  it("leaves the scale at 1 until the sizes are known, and keeps a readable minimum", () => {
    expect(fitScale(0, 0, 408, 800)).toBe(1);
    expect(fitScale(420, 560, 0, 0)).toBe(1);
    expect(fitScale(100, 100, 408, 800)).toBe(0.3);
  });
});
