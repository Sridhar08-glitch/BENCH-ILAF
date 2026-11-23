import { describe, expect, it } from "vitest";
import { BELOW_COUNT, FACE_COUNT, INTRO_COUNT } from "@/lib/library";
import {
  PAGE_SIZE, STEPS, backStep, belowItems, faceItems, filterItems, firstStep, goToStep, introItems, isDone, nextStep, pad, pageOf, pagesToShow, randomBetween,
  type Item,
} from "./logic";

const sample: Item[] = [
  { n: 1, name: "Classic", tags: ["corporate"], description: "" },
  { n: 2, name: "Neon Grid", tags: ["tech", "bold"], description: "Glowing lines" },
  { n: 12, name: "Soft Blob", tags: ["playful"], description: "" },
];

describe("steps", () => {
  it("has six steps in the agreed order", () => {
    expect(STEPS.map((s) => s.key)).toEqual(["face", "colour", "text", "below", "anim", "finish"]);
  });
  it("moves forward and back within bounds and remembers how far you got", () => {
    let s = firstStep();
    expect(backStep(s).step).toBe(0);
    s = nextStep(nextStep(s));
    expect(s).toEqual({ step: 2, reached: 2 });
    s = backStep(s);
    expect(s).toEqual({ step: 1, reached: 2 });
    for (let i = 0; i < 10; i++) s = nextStep(s);
    expect(s.step).toBe(5);
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
    expect(introItems()).toHaveLength(INTRO_COUNT);
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
