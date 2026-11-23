import { describe, expect, it } from "vitest";
import { assigneeLabel, brandSwatches, cardStateWord, fontName, seatsInfo, shortDay, viewsPoints } from "./company-page";

describe("seatsInfo", () => {
  it("has no seats without a plan", () => {
    expect(seatsInfo(3, 0)).toMatchObject({ percent: 0, state: "none" });
  });
  it("is fine below 90 percent", () => {
    const s = seatsInfo(8, 10);
    expect(s).toMatchObject({ percent: 80, state: "ok" });
    expect(s.note).toBe("2 seats left.");
  });
  it("warns from 90 percent", () => {
    expect(seatsInfo(9, 10)).toMatchObject({ percent: 90, state: "near", note: "Near the limit: 1 seat left." });
    expect(seatsInfo(96, 100).state).toBe("near");
  });
  it("says when full and never passes 100", () => {
    expect(seatsInfo(10, 10)).toMatchObject({ percent: 100, state: "full" });
    expect(seatsInfo(12, 10).percent).toBe(100);
  });
});

describe("chart helpers", () => {
  it("writes days as day and month", () => {
    expect(shortDay("2026-11-05")).toBe("5 Nov");
    expect(shortDay("nonsense")).toBe("nonsense");
  });
  it("makes one point per day", () => {
    expect(viewsPoints([{ day: "2026-11-22", views: 4 }, { day: "2026-11-23", views: 0 }])).toEqual([{ label: "22 Nov", value: 4 }, { label: "23 Nov", value: 0 }]);
  });
});

describe("brand helpers", () => {
  it("names fonts", () => {
    expect(fontName("cairo")).toBe("Cairo");
    expect(fontName("face")).toMatch(/own fonts/);
    expect(fontName(undefined)).toMatch(/own fonts/);
    expect(fontName("mystery")).toBe("mystery");
  });
  it("keeps only real hex colours", () => {
    expect(brandSwatches({ primary: "#12284b", accent: "red" })).toEqual([{ name: "Main colour", hex: "#12284b" }]);
    expect(brandSwatches(null)).toEqual([]);
  });
  it("words the card state", () => {
    expect(cardStateWord("published")).toBe("Live");
    expect(cardStateWord("none")).toBe("No card");
  });
  it("labels a person", () => {
    expect(assigneeLabel({ full_name: "Priya", email: "p@x.test" })).toBe("Priya (p@x.test)");
    expect(assigneeLabel({ full_name: "", email: "p@x.test" })).toBe("p@x.test");
  });
});
