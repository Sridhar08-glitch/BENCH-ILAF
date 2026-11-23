import { describe, expect, it } from "vitest";
import { cr } from "@/lib/library/company/colour";
import { candidateIsReadable, complement, livelier, logoSwatches, medianCut, paletteCandidates, usablePixels, type RgbaImage } from "./palette-from-logo";

type Rgba = [number, number, number, number];

/** A synthetic logo: rows of flat colour blocks, each [colour, number of pixels]. */
function image(blocks: [Rgba, number][], width = 20): RgbaImage {
  const data: number[] = [];
  for (const [c, n] of blocks) for (let i = 0; i < n; i++) data.push(...c);
  return { data, width, height: Math.ceil(data.length / 4 / width) };
}

const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const CLEAR: Rgba = [255, 0, 0, 0];
const BLUE: Rgba = [20, 80, 200, 255];
const ORANGE: Rgba = [240, 120, 20, 255];
const GREEN: Rgba = [30, 160, 90, 255];

describe("pixels worth looking at", () => {
  it("ignores transparent, near-white and near-black pixels", () => {
    const px = usablePixels(image([[CLEAR, 100], [WHITE, 100], [[250, 250, 250, 255], 50], [BLACK, 100], [[10, 10, 10, 255], 20], [BLUE, 40]]));
    expect(px.reduce((n, p) => n + p.count, 0)).toBe(40);
  });

  it("a half transparent pixel is not counted, a mostly opaque one is", () => {
    expect(usablePixels(image([[[200, 40, 40, 100], 10]]))).toEqual([]);
    expect(usablePixels(image([[[200, 40, 40, 200], 10]])).reduce((n, p) => n + p.count, 0)).toBe(10);
  });

  it("a logo with nothing usable gives no candidates", () => {
    expect(paletteCandidates(image([[WHITE, 200], [CLEAR, 100], [BLACK, 50]]))).toEqual([]);
    expect(paletteCandidates({ data: [], width: 0, height: 0 })).toEqual([]);
  });
});

describe("median cut", () => {
  it("separates distinct colours and keeps their share of the area", () => {
    const sw = logoSwatches(image([[BLUE, 300], [ORANGE, 100], [GREEN, 50]]), 3);
    expect(sw).toHaveLength(3);
    expect(sw.map((s) => s.count)).toEqual([300, 100, 50]);
    expect(sw[0].hex).toBe("#1450c8");
  });

  it("never returns more boxes than asked, and handles one colour", () => {
    expect(medianCut(usablePixels(image([[BLUE, 100]])), 6)).toHaveLength(1);
    expect(medianCut([], 4)).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i): [Rgba, number] => [[i * 6, 200 - i * 4, 80 + i, 255], 5]);
    expect(medianCut(usablePixels(image(many)), 4).length).toBeLessThanOrEqual(4);
  });

  it("averages noisy pixels of one colour into one swatch", () => {
    const sw = logoSwatches(image([[[20, 80, 200, 255], 50], [[22, 82, 198, 255], 50], [[19, 79, 201, 255], 50]]), 4);
    expect(sw).toHaveLength(1);
    expect(sw[0].count).toBe(150);
  });
});

describe("candidate palettes", () => {
  it("makes a primary and an accent from the two biggest colours, up to three palettes", () => {
    const list = paletteCandidates(image([[WHITE, 200], [BLUE, 300], [ORANGE, 120], [BLACK, 80]]));
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.length).toBeLessThanOrEqual(3);
    expect(list[0].primary).toBe("#1450c8");
    expect(list[0].mode).toBe("brand");
    expect(new Set(list.map((c) => `${c.primary}|${c.accent}|${c.mode}`)).size).toBe(list.length);
  });

  it("a one colour logo gets an accent from the other side of the colour wheel", () => {
    const [first] = paletteCandidates(image([[BLUE, 300], [WHITE, 100]]));
    expect(first.accent).not.toBe(first.primary);
    expect(cr(first.primary, first.accent)).toBeGreaterThanOrEqual(1.5);
  });

  it("every candidate keeps the readability guarantees of the colour pickers", () => {
    const logos = [
      image([[BLUE, 300], [ORANGE, 100]]),
      image([[[250, 220, 40, 255], 200], [[30, 30, 120, 255], 90]]),
      image([[[40, 40, 40, 255], 100], [[120, 120, 125, 255], 200]]), // greys only
      image([[[255, 240, 120, 255], 100]]), // a pale yellow
      image([[[5, 5, 60, 255], 100], [[60, 20, 140, 255], 100]]),
    ];
    for (const logo of logos) {
      const list = paletteCandidates(logo);
      expect(list.length).toBeGreaterThan(0);
      for (const c of list) {
        expect(c.primary).toMatch(/^#[0-9a-f]{6}$/);
        expect(c.accent).toMatch(/^#[0-9a-f]{6}$/);
        expect(candidateIsReadable(c), `${c.primary} ${c.accent} ${c.mode}`).toBe(true);
        expect(c.derived.ratios.acc).toBeGreaterThanOrEqual(4.5);
        expect(cr(c.primary, c.accent)).toBeGreaterThanOrEqual(1.5);
      }
    }
  });

  it("a grey logo is made lively instead of giving grey brand colours", () => {
    const [c] = paletteCandidates(image([[[120, 120, 125, 255], 200]]));
    const hex = livelier("#78787d");
    expect(hex).not.toBe("#78787d");
    expect(c.primary).toBe(hex);
  });

  it("is deterministic", () => {
    const logo = image([[BLUE, 300], [ORANGE, 100], [GREEN, 60]]);
    expect(paletteCandidates(logo)).toEqual(paletteCandidates(logo));
  });
});

describe("helpers", () => {
  it("complement is on the other side of the colour wheel", () => {
    expect(complement("#1450c8")).not.toBe("#1450c8");
    expect(complement("#1450c8")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
