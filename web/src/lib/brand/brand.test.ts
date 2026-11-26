import { describe, expect, it } from "vitest";
import { fitInside, keyWhite, trimBounds } from "./logo-file";
import { brandProblem, brandProblems } from "./errors";
import { brandPatch, designKey, dragged, fullBrand, logoSpotOf, paletteFor, startColours, textReadability, withColours, withLogoSpot, withMode } from "./state";
import { ApiError } from "@/lib/api";
import { defaultDesign } from "@/lib/library";
import type { Brand } from "@/lib/types";
import { createI18n } from "@/lib/i18n";
import { en } from "@/lib/i18n/messages";

const { t } = createI18n("en", "latn", en);

/** A w x h picture of one colour (RGBA). */
function flat(w: number, h: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(rgba, i * 4);
  return px;
}

function setRect(px: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number, rgba: [number, number, number, number]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.set(rgba, (y * w + x) * 4);
}

describe("logo file preparation", () => {
  it("removes a plain white background and keeps the mark", () => {
    const w = 40;
    const h = 30;
    const px = flat(w, h, [255, 255, 255, 255]);
    setRect(px, w, 10, 8, 30, 22, [15, 45, 92, 255]);
    expect(keyWhite(px, w, h)).toBe(true);
    expect(px[3]).toBe(0);
    expect(px[(15 * w + 20) * 4 + 3]).toBe(255);
    const b = trimBounds(px, w, h);
    expect(b).not.toBeNull();
    expect(b!.x0).toBeGreaterThanOrEqual(8);
    expect(b!.x1).toBeLessThanOrEqual(31);
  });

  it("leaves a picture without a plain white border alone", () => {
    const w = 20;
    const h = 20;
    const px = flat(w, h, [20, 80, 160, 255]);
    const copy = px.slice();
    expect(keyWhite(px, w, h)).toBe(false);
    expect(Array.from(px)).toEqual(Array.from(copy));
    // a picture that is almost all white (nothing to keep) is also left alone
    const white = flat(w, h, [255, 255, 255, 255]);
    expect(keyWhite(white, w, h)).toBe(true);
  });

  it("trims the empty margin of a transparent picture, and reports an empty one", () => {
    const w = 50;
    const h = 20;
    const px = flat(w, h, [0, 0, 0, 0]);
    setRect(px, w, 5, 5, 45, 15, [0, 0, 0, 255]);
    expect(trimBounds(px, w, h)).toEqual({ x0: 4, y0: 4, x1: 45, y1: 15 });
    expect(trimBounds(flat(10, 10, [0, 0, 0, 0]), 10, 10)).toBeNull();
  });

  it("shrinks a picture to its longest side and never enlarges it", () => {
    expect(fitInside(3200, 1600, 1600)).toEqual({ w: 1600, h: 800 });
    expect(fitInside(400, 900, 800)).toEqual({ w: 356, h: 800 });
    expect(fitInside(100, 50, 800)).toEqual({ w: 100, h: 50 });
  });
});

describe("plain-language brand errors", () => {
  it("names the field in words", () => {
    const e = new ApiError(400, "validation_error", "Bad", { "brand.palette": ["The text colour is hard to read."], "brand.artwork.pattern.opacity": ["Use 5 to 60."], odd: ["Odd one."] });
    expect(brandProblems(e, t)).toEqual(["Brand colours: The text colour is hard to read.", "Pattern opacity: Use 5 to 60.", "Odd one."]);
    expect(brandProblem(e, t)).toContain("Brand colours");
  });
  it("falls back to the message", () => {
    expect(brandProblem(new ApiError(403, "plan_limit", "Upgrade to add more."), t)).toBe("Upgrade to add more.");
    expect(brandProblem(new Error("x"), t)).toMatch(/could not save/i);
    expect(brandProblem(null, t)).toMatch(/could not save/i);
  });
});

const base: Brand = { company_name: "Acme", logo_url: null, website: "", design: defaultDesign(), lock_design: false, show_footer: true };

describe("brand page state", () => {
  it("fills the settings an older company does not have", () => {
    const b = fullBrand(base);
    expect(b.logo_display).toBe("auto");
    expect(b.artwork.mode).toBe("none");
    expect(b.palette).toBeNull();
  });

  it("sets colours and palette together, and clears both together", () => {
    const on = withColours(fullBrand(base), { primary: "#0f2d5c", accent: "#d2a63b", mode: "brand" });
    expect(on.palette).toEqual({ bg: "#0f2d5c", bg2: "#2b456f", fg: "#f8f9fa", acc: "#d2a63b", on: "#0f2d5c" });
    const patch = brandPatch(on, true);
    expect(patch.colours).toEqual({ primary: "#0f2d5c", accent: "#d2a63b", mode: "brand" });
    expect(patch.palette).toEqual(on.palette);
    const off = withColours({ ...on, design: { ...on.design, colour: 4 } }, null);
    expect(off.colours).toBeNull();
    expect(off.palette).toBeNull();
    expect(off.design.colour).toBe(0);
    expect(brandPatch(off, true)).toMatchObject({ colours: null, palette: null });
  });

  it("never sends company-only keys for a personal workspace", () => {
    const keys = Object.keys(brandPatch(fullBrand(base), false));
    expect(keys.sort()).toEqual(["company_name", "design", "lock_design", "show_footer", "website"]);
  });

  it("starts the colour pickers at defaults and keeps the owner's colours", () => {
    expect(startColours(fullBrand(base)).mode).toBe("brand");
    expect(startColours(withColours(fullBrand(base), { primary: "#112233", accent: "#445566", mode: "dark" }))).toMatchObject({ primary: "#112233", mode: "dark" });
  });

  it("makes a chosen way of appearing show something at once", () => {
    const b = fullBrand(base);
    expect(withMode(b, "background").artwork.background).toMatchObject({ kind: "sample", sample: "geo" });
    expect(withMode(b, "pattern").artwork.pattern.enabled).toBe(true);
    expect(withMode(b, "template").artwork.template).toMatchObject({ kind: "sample", sample: "harbor", zone: "A" });
    expect(withMode(b, "none").artwork.mode).toBe("none");
    // the source brand is never changed
    expect(b.artwork.mode).toBe("none");
  });
});

describe("logo size, logo place and own text colour", () => {
  const base = () => fullBrand({ company_name: "Shark", website: "", design: defaultDesign(), lock_design: false, show_footer: true } as Brand);

  it("starts at full size with no places and sends both with the save", () => {
    const b = base();
    expect(b.logo_size).toBe(100);
    expect(b.logo_free).toEqual({});
    const p = brandPatch({ ...b, logo_size: 80, logo_free: { f1: { x: 5, y: 6, w: 30 } } }, true);
    expect(p.logo_size).toBe(80);
    expect(p.logo_free).toEqual({ f1: { x: 5, y: 6, w: 30 } });
    expect(brandPatch(b, false)).not.toHaveProperty("logo_size");
  });

  it("keys a place by the design: card face or page style", () => {
    expect(designKey({ face: 12, top: 0 })).toBe("f12");
    expect(designKey({ face: 12, top: 3 })).toBe("t3");
  });

  it("places the logo on the current design only, and puts it back to automatic", () => {
    const b = base();
    const placed = withLogoSpot(b, { x: 6.04, y: 8, w: 28 });
    expect(logoSpotOf(placed)).toEqual({ x: 6, y: 8, w: 28 });
    expect(logoSpotOf({ ...placed, design: { ...placed.design, face: 2 } })).toBeNull();
    expect(logoSpotOf(withLogoSpot(placed, null))).toBeNull();
  });

  it("keeps a dragged logo inside the card", () => {
    expect(dragged({ x: 5, y: 5, w: 30 }, 90, -4, 20)).toEqual({ x: 70, y: 0, w: 30 });
    expect(dragged({ x: 5, y: 5, w: 30 }, 10, 95, 20)).toEqual({ x: 10, y: 80, w: 30 });
  });

  it("uses the owner's text colour in the palette and says if it is hard to read", () => {
    const c = { primary: "#0b3a66", accent: "#f5a623", mode: "brand" as const };
    expect(paletteFor(c).fg).not.toBe("#7a8cff");
    expect(paletteFor({ ...c, text: "#7a8cff" }).fg).toBe("#7a8cff");
    expect(textReadability(c).ok).toBe(true);
    expect(textReadability({ ...c, text: "#7a8cff" }).ok).toBe(false);
    expect(withColours(base(), { ...c, text: "#ffffff" }).palette?.fg).toBe("#ffffff");
  });
});
