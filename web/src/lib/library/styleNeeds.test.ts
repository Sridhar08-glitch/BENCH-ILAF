import { describe, expect, it } from "vitest";
import { TOP_COUNT, defaultDesign } from "./index";
import { fieldsOf } from "./fieldsUsed";
import { slotsOf, styleNeeds, type CardHas } from "./styleNeeds";
import { TOP_SLOTS } from "./fields";

const full: CardHas = { title: "Designer", company: "Studio", address: "Doha", bio: "About me", photo: true, cover: true, buttons: 8 };
const empty: CardHas = { title: "", company: "  ", address: "", bio: "", photo: false, cover: false, buttons: 0 };
const design = (top: number, face = 1) => ({ ...defaultDesign(), top, face });

describe("what a style asks for", () => {
  it("lists exactly the details the design draws, plus the buttons", () => {
    for (const top of [0, 1, 5, 28, 90, 130, 178, TOP_COUNT]) {
      const d = design(top);
      const n = styleNeeds(d, full);
      const f = fieldsOf(d);
      expect(n.shows.filter((x) => x.key !== "buttons").map((x) => x.key).sort(), `top ${top}`).toEqual((Object.keys(f) as (keyof typeof f)[]).filter((k) => f[k]).sort());
      expect(n.shows.some((x) => x.key === "buttons")).toBe(true);
      // a detail is either asked for or listed as not drawn, never both
      for (const h of n.hidden) expect(n.shows.some((x) => x.key === h)).toBe(false);
      expect(n.shows.every((x) => !x.missing)).toBe(true);
    }
  });

  it("marks what the card still lacks, and treats blanks as empty", () => {
    const n = styleNeeds(design(1), empty);
    const missing = n.shows.filter((x) => x.missing).map((x) => x.key);
    expect(missing).toContain("cover");
    expect(missing).toContain("buttons");
    expect(styleNeeds(design(1), { ...empty, company: "  " }).shows.find((x) => x.key === "company")?.missing).toBe(true);
    expect(styleNeeds(design(1), { ...full, cover: false }).shows.filter((x) => x.missing).map((x) => x.key)).toEqual(["cover"]);
  });

  it("does not ask for a detail the style does not draw", () => {
    const bare = { ...empty, buttons: 8 };
    for (let top = 1; top <= TOP_COUNT; top++) {
      const n = styleNeeds(design(top), bare);
      const f = fieldsOf(design(top));
      for (const x of n.shows) if (x.key !== "buttons") expect(f[x.key], `top ${top} ${x.key}`).toBe(true);
      if (!f.cover) expect(n.shows.some((x) => x.key === "cover")).toBe(false);
    }
  });

  it("knows how many buttons a page style draws, from the generated table", () => {
    expect(TOP_SLOTS.length).toBe(TOP_COUNT);
    for (let top = 1; top <= TOP_COUNT; top++) {
      expect(slotsOf({ top, custom_face: null }), `top ${top}`).toBeGreaterThan(0);
      const n = styleNeeds(design(top), full);
      expect(n.wanted).toBeLessThanOrEqual(n.slots ?? 3);
      expect(n.ownLayout).toBe(true);
    }
    expect(slotsOf({ top: 0, custom_face: null })).toBeNull();
    expect(styleNeeds(design(0), full).ownLayout).toBe(false);
  });

  it("asks for buttons only when the card has fewer than the style fills", () => {
    const d = design(1);
    const wanted = styleNeeds(d, full).wanted;
    expect(styleNeeds(d, { ...full, buttons: wanted }).shows.find((x) => x.key === "buttons")?.missing).toBe(false);
    expect(styleNeeds(d, { ...full, buttons: wanted - 1 }).shows.find((x) => x.key === "buttons")?.missing).toBe(wanted > 0);
  });

  it("asks for everything under a company's own face", () => {
    expect(styleNeeds({ ...design(0), custom_face: 5 }, full).hidden).toEqual([]);
  });
});
