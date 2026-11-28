import { describe, expect, it } from "vitest";
import { BELOW_COUNT, FACE_COUNT, INTRO_COUNT } from "@/lib/library";
import { PACK1_COUNT, PAGE_SIZE, STEPS, belowForTop, faceStepApplies, needsPaidPlan, offeredBelowCount, stepsFor, topItems, topNumberOf, TOP_STYLES, backStep, belowItems, faceItems, filterItems, firstStep, goToStep, introForTop, introItems, isDone, nextStep, offeredFaces, packOf, pad, pageOf, pagesToShow, randomBetween, type Item, STEP_TITLES, visibleSteps } from "./logic";

const sample: Item[] = [
  { n: 1, name: "Classic", tags: ["corporate"], description: "" },
  { n: 2, name: "Neon Grid", tags: ["tech", "bold"], description: "Glowing lines" },
  { n: 12, name: "Soft Blob", tags: ["playful"], description: "" },
];

describe("steps", () => {
  it("has seven steps in the agreed order, the page-style header first", () => {
    expect(STEPS.map((s) => s.key)).toEqual(["top", "face", "colour", "text", "below", "anim", "finish"]);
  });
  it("drops the Top step while the page styles switch is off", () => {
    expect(stepsFor(true)).toHaveLength(7);
    expect(stepsFor(false).map((s) => s.key)).toEqual(["face", "colour", "text", "below", "anim", "finish"]);
    expect(nextStep({ step: 4, reached: 4 }, 6)).toEqual({ step: 5, reached: 5 });
    expect(nextStep({ step: 5, reached: 5 }, 6).step).toBe(5);
  });
  it("moves forward and back within bounds and remembers how far you got", () => {
    let s = firstStep();
    expect(backStep(s).step).toBe(0);
    s = nextStep(nextStep(s));
    expect(s).toEqual({ step: 2, reached: 2 });
    s = backStep(s);
    expect(s).toEqual({ step: 1, reached: 2 });
    for (let i = 0; i < 10; i++) s = nextStep(s);
    expect(s.step).toBe(6);
  });
  it("jumps only to steps already reached", () => {
    const s = { step: 1, reached: 2 };
    expect(goToStep(s, 0).step).toBe(0);
    expect(goToStep(s, 2).step).toBe(2);
    expect(goToStep(s, 3)).toBe(s);
    expect(goToStep(s, -1)).toBe(s);
  });
  it("ticks steps you have moved past", () => {
    const s = { step: 0, reached: 2 };
    expect([0, 1, 2, 3].map((i) => isDone(s, i))).toEqual([true, true, false, false]);
  });
});

describe("library lists", () => {
  it("cover every numbered item", () => {
    expect(faceItems()).toHaveLength(FACE_COUNT);
    expect(belowItems()).toHaveLength(BELOW_COUNT);
    // Openings 1 to 400 are for the flip card, the last six for the page styles; each kind of look is offered its own.
    expect(introItems(false)).toHaveLength(400);
    expect(introItems(true)).toHaveLength(INTRO_COUNT - 400);
    expect(faceItems()[0].n).toBe(1);
    expect(faceItems()[FACE_COUNT - 1].n).toBe(FACE_COUNT);
  });
  it("pads numbers", () => expect(pad(7)).toBe("007"));
});

describe("filterItems", () => {
  it("returns everything for an empty search", () => expect(filterItems(sample, "  ")).toHaveLength(3));
  it("matches names without regard to case", () => expect(filterItems(sample, "neon").map((i) => i.n)).toEqual([2]));
  it("matches the description and the tags", () => {
    expect(filterItems(sample, "glowing").map((i) => i.n)).toEqual([2]);
    expect(filterItems(sample, "playful").map((i) => i.n)).toEqual([12]);
  });
  it("matches a number typed in any form", () => {
    expect(filterItems(sample, "12").map((i) => i.n)).toEqual([12]);
    expect(filterItems(sample, "#012").map((i) => i.n)).toEqual([12]);
  });
  it("needs every word to match", () => {
    expect(filterItems(sample, "neon bold")).toHaveLength(1);
    expect(filterItems(sample, "neon playful")).toHaveLength(0);
  });
  it("filters by tag and combines it with the search", () => {
    expect(filterItems(sample, "", "tech").map((i) => i.n)).toEqual([2]);
    expect(filterItems(sample, "classic", "tech")).toHaveLength(0);
  });
  it("finds real faces by tag", () => {
    const corp = filterItems(faceItems(), "", "corporate");
    expect(corp.length).toBeGreaterThan(0);
    expect(corp.every((i) => i.tags.includes("corporate"))).toBe(true);
  });
  it("finds Design Pack 2 faces by number, by pack and by tag, and hides them when the switch is off", () => {
    expect(filterItems(faceItems(), "437").map((i) => i.n)).toEqual([437]);
    expect(filterItems(faceItems(), "#500").map((i) => i.n)).toEqual([500]);
    expect(packOf(400)).toBe(1);
    expect(packOf(401)).toBe(2);
    expect(filterItems(faceItems(), "", null, undefined, 2).map((i) => i.n)).toEqual(Array.from({ length: 100 }, (_, i) => 401 + i));
    expect(filterItems(faceItems(), "", null, undefined, 1)).toHaveLength(PACK1_COUNT);
    const lux = filterItems(faceItems(), "", "luxury", undefined, 2);
    expect(lux.length).toBeGreaterThan(0);
    expect(lux.every((i) => i.n > PACK1_COUNT && i.tags.includes("luxury"))).toBe(true);
    expect(offeredFaces(true)).toHaveLength(FACE_COUNT);
    expect(offeredFaces(false)).toHaveLength(PACK1_COUNT);
    expect(offeredFaces(false).every((i) => i.n <= PACK1_COUNT)).toBe(true);
  });
});

describe("page styles", () => {
  it("lists the 227 headers with their app pattern or design family as the tag", () => {
    expect(topItems()).toHaveLength(227);
    const styles = new Set(topItems().map((i) => i.tags[0]));
    expect([...styles].sort()).toEqual([...TOP_STYLES].sort());
    expect(filterItems(topItems(), "", "Dot").map((i) => i.n)).toEqual([22, 23, 24, 25]);
    expect(filterItems(topItems(), "", "Arabic").map((i) => i.n)).toEqual([26, 27]);
    expect(filterItems(topItems(), "", "Editorial").map((i) => i.n)).toEqual(Array.from({ length: 10 }, (_, i) => 28 + i));
    expect(filterItems(topItems(), "", "Gulf").map((i) => i.n)).toEqual(Array.from({ length: 10 }, (_, i) => 58 + i));
    expect(filterItems(topItems(), "", "Business").map((i) => i.n)).toEqual(Array.from({ length: 10 }, (_, i) => 78 + i));
    expect(filterItems(topItems(), "", "Events and Lifestyle").map((i) => i.n)).toEqual(Array.from({ length: 10 }, (_, i) => 118 + i));
    expect(filterItems(topItems(), "", "Unique").map((i) => i.n)).toEqual(Array.from({ length: 50 }, (_, i) => 128 + i));
    expect(filterItems(topItems(), "", "Link in bio").map((i) => i.n)).toEqual(Array.from({ length: 50 }, (_, i) => 178 + i));
    expect(TOP_STYLES).toHaveLength(20);
  });
  it("offers 627 layouts, or 400 while the switch is off, and marks 401 to 627 as Pack 2", () => {
    expect(belowItems()).toHaveLength(627);
    expect(belowItems(false)).toHaveLength(400);
    expect(offeredBelowCount(true)).toBe(627);
    expect(offeredBelowCount(false)).toBe(400);
    expect(filterItems(belowItems(), "", null, undefined, 2).map((i) => i.n)).toEqual(Array.from({ length: 227 }, (_, i) => 401 + i));
    expect(filterItems(belowItems(), "", null, undefined, 1)).toHaveLength(400);
  });
  it("picking a header picks the layout of its own page; Classic keeps a Pack 1 layout", () => {
    expect(belowForTop(1, 5)).toBe(401);
    expect(belowForTop(27, 1)).toBe(427);
    expect(belowForTop(77, 1)).toBe(477);
    expect(belowForTop(127, 1)).toBe(527);
    expect(belowForTop(227, 1)).toBe(627);
    expect(belowForTop(0, 250)).toBe(250);
    expect(belowForTop(0, 410)).toBe(1);
    expect(topNumberOf(404)).toBe(4);
  });
  it("greys the Face step under a header, except where the face sits inside the card block", () => {
    expect(faceStepApplies(0)).toBe(true);
    for (const n of [4, 5, 6, 7, 8, 27]) expect(faceStepApplies(n), String(n)).toBe(true);
    for (const n of [1, 2, 3, 9, 14, 20, 22, 24, 26]) expect(faceStepApplies(n), String(n)).toBe(false);
  });
  it("asks for a paid plan for any header and for layouts above 400", () => {
    expect(needsPaidPlan({ top: 0, below: 400 })).toBe(false);
    expect(needsPaidPlan({ top: 3, below: 1 })).toBe(true);
    expect(needsPaidPlan({ top: 0, below: 401 })).toBe(true);
  });
});

describe("paging", () => {
  const list = Array.from({ length: 50 }, (_, i) => ({ n: i + 1, name: "x", tags: [], description: "" }));
  it("shows one page at a time and counts the rest", () => {
    expect(pageOf(list, 1)).toMatchObject({ more: 50 - PAGE_SIZE });
    expect(pageOf(list, 1).shown).toHaveLength(PAGE_SIZE);
    expect(pageOf(list, 3)).toMatchObject({ more: 0 });
    expect(pageOf(list, 3).shown).toHaveLength(50);
  });
  it("treats a bad page count as one page", () => expect(pageOf(list, 0).shown).toHaveLength(PAGE_SIZE));
  it("opens enough pages to show the chosen item", () => {
    expect(pagesToShow(list, 1)).toBe(1);
    expect(pagesToShow(list, PAGE_SIZE)).toBe(1);
    expect(pagesToShow(list, PAGE_SIZE + 1)).toBe(2);
    expect(pagesToShow(list, 999)).toBe(1);
  });
});

describe("randomBetween", () => {
  it("stays in range at both ends", () => {
    expect(randomBetween(1, 400, () => 0)).toBe(1);
    expect(randomBetween(1, 400, () => 0.999999)).toBe(400);
    expect(randomBetween(0, 3, () => 0.5)).toBe(2);
  });
});

describe("the steps the design picker shows", () => {
  it("has the title and the sentence for every step, so no step can open without its texts", () => {
    for (const step of STEPS) {
      const titles = STEP_TITLES[step.key];
      expect(titles, step.key).toBeDefined();
      expect(titles).toHaveLength(2);
      expect(titles[0]).toMatch(/^editor\./);
      expect(titles[1]).toMatch(/^editor\./);
    }
  });

  it("starts with the Top step and walks every step in the agreed order", () => {
    expect(visibleSteps(true, 0).map((x) => x.key)).toEqual(["top", "face", "colour", "text", "below", "anim", "finish"]);
  });

  it("drops the Top step while the page styles switch is off, whatever the saved header is", () => {
    expect(visibleSteps(false, 0).map((x) => x.key)).toEqual(["face", "colour", "text", "below", "anim", "finish"]);
    expect(visibleSteps(false, 5).map((x) => x.key)).toContain("face");
  });

  it("drops the Face step under a header that has no face, and keeps it under one that draws the face inside its card", () => {
    expect(faceStepApplies(1)).toBe(false);                     // Popl cover photo
    expect(visibleSteps(true, 1).map((x) => x.key)).not.toContain("face");
    expect(faceStepApplies(4)).toBe(true);                      // Blinq solid card
    expect(visibleSteps(true, 4).map((x) => x.key)).toContain("face");
  });

  it("lists the 227 headers and offers the 400 classic layouts only without page styles", () => {
    expect(topItems()).toHaveLength(227);
    expect(offeredBelowCount(true)).toBe(627);
    expect(offeredBelowCount(false)).toBe(400);
  });

  it("gives a header its own button layout, and keeps a classic card's layout out of that range", () => {
    expect(belowForTop(3, 12)).toBe(403);
    expect(belowForTop(0, 405)).toBe(1);
    expect(belowForTop(0, 12)).toBe(12);
  });

  it("knows which choices need a paid plan", () => {
    expect(needsPaidPlan({ top: 0, below: 12 })).toBe(false);
    expect(needsPaidPlan({ top: 2, below: 12 })).toBe(true);
    expect(needsPaidPlan({ top: 0, below: 410 })).toBe(true);
  });
});

describe("the opening that goes with the look", () => {
  it("gives a page style a page-style opening and the other way round, and keeps none", () => {
    expect(introForTop(3, 12)).toBe(401);
    expect(introForTop(3, 404)).toBe(404);
    expect(introForTop(0, 404)).toBe(1);
    expect(introForTop(0, 12)).toBe(12);
    expect(introForTop(3, 0)).toBe(0);
  });
});
