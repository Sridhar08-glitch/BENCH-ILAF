import { describe, expect, it } from "vitest";
import { isVisible, nextIndex, placeTip, scrollTarget, spotlight } from "./position";
import { TOURS, tourFor } from "./tours";

const vp = { width: 1000, height: 700 };
const tip = { width: 300, height: 120 };

describe("spotlight", () => {
  it("grows the target and stays inside the screen", () => {
    expect(spotlight({ top: 100, left: 100, width: 200, height: 50 }, vp, 6)).toEqual({ top: 94, left: 94, width: 212, height: 62 });
    expect(spotlight({ top: 0, left: 0, width: 50, height: 50 }, vp, 6)).toEqual({ top: 0, left: 0, width: 56, height: 56 });
    expect(spotlight({ top: 650, left: 950, width: 100, height: 100 }, vp, 6)).toEqual({ top: 644, left: 944, width: 56, height: 56 });
  });
});

describe("placeTip", () => {
  it("prefers below, centred on the target and kept on screen", () => {
    const p = placeTip({ top: 100, left: 400, width: 100, height: 40 }, tip, vp);
    expect(p.placement).toBe("bottom");
    expect(p.top).toBe(152);
    expect(p.left).toBe(300);
    const edge = placeTip({ top: 100, left: 0, width: 40, height: 40 }, tip, vp);
    expect(edge.left).toBe(12);
  });

  it("goes above when there is no room below", () => {
    const p = placeTip({ top: 600, left: 400, width: 100, height: 60 }, tip, vp);
    expect(p.placement).toBe("top");
    expect(p.top).toBe(600 - 12 - 120);
  });

  it("goes beside a tall target, on the reading-end side first", () => {
    const tall = { top: 20, left: 100, width: 100, height: 660 };
    const ltr = placeTip(tall, tip, vp, false);
    expect(ltr.placement).toBe("end");
    expect(ltr.left).toBe(212);
    const rtlTarget = { top: 20, left: 800, width: 100, height: 660 };
    const rtl = placeTip(rtlTarget, tip, vp, true);
    expect(rtl.placement).toBe("end");
    expect(rtl.left).toBe(800 - 12 - 300);
  });

  it("centres when the target is missing or empty", () => {
    expect(placeTip(null, tip, vp).placement).toBe("center");
    expect(placeTip({ top: 0, left: 0, width: 0, height: 0 }, tip, vp).placement).toBe("center");
    const c = placeTip(null, tip, vp);
    expect(c.left).toBe(350);
    expect(c.top).toBe(290);
  });

  it("never leaves the screen on a tiny viewport", () => {
    const small = { width: 320, height: 480 };
    const p = placeTip({ top: 0, left: 0, width: 320, height: 480 }, { width: 296, height: 200 }, small);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.top + 200).toBeLessThanOrEqual(480);
  });
});

describe("scrolling and stepping", () => {
  it("knows what is visible and where to scroll", () => {
    expect(isVisible({ top: 10, left: 10, width: 10, height: 10 }, vp)).toBe(true);
    expect(isVisible({ top: 800, left: 10, width: 10, height: 10 }, vp)).toBe(false);
    expect(scrollTarget({ top: 100, left: 0, width: 10, height: 10 }, vp, 0)).toBeNull();
    expect(scrollTarget({ top: 900, left: 0, width: 10, height: 10 }, vp, 100)).toBe(Math.round(100 + 900 - 700 / 3));
    expect(scrollTarget({ top: -500, left: 0, width: 10, height: 10 }, vp, 100)).toBe(0);
  });

  it("steps over missing targets", () => {
    const present = [true, false, true, false];
    expect(nextIndex(0, 1, present)).toBe(2);
    expect(nextIndex(2, 1, present)).toBeNull();
    expect(nextIndex(2, -1, present)).toBe(0);
    expect(nextIndex(0, -1, present)).toBeNull();
  });
});

describe("tours", () => {
  it("each tour has 3 to 6 tips with a target selector", () => {
    for (const t of TOURS) {
      expect(t.tips.length, t.id).toBeGreaterThanOrEqual(3);
      expect(t.tips.length, t.id).toBeLessThanOrEqual(6);
      for (const tp of t.tips) expect(tp.target).toMatch(/^\[data-guide="[a-z-]+"\]$/);
    }
  });

  it("finds the tour of a page", () => {
    expect(tourFor("/app/cards")?.id).toBe("cards");
    expect(tourFor("/app/cards/")?.id).toBe("cards");
    expect(tourFor("/app/cards/abc")?.id).toBe("editor");
    expect(tourFor("/app/brand")?.id).toBe("brand");
    expect(tourFor("/app/team")?.id).toBe("team");
    expect(tourFor("/app/contacts")?.id).toBe("contacts");
    expect(tourFor("/app/analytics")?.id).toBe("analytics");
    expect(tourFor("/app/settings/integrations")?.id).toBe("integrations");
    expect(tourFor("/app/qr")).toBeNull();
    expect(tourFor("/app")).toBeNull();
  });
});
