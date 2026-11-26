import { describe, expect, it } from "vitest";
import { GUIDED, guidedSteps, nextOf, prevOf } from "./guided";

describe("guided order", () => {
  it("runs look, colour, details, buttons, under the card, extras, share", () => {
    expect(guidedSteps({ locked: false, extras: true })).toEqual([...GUIDED]);
  });
  it("skips the design steps when the company locks the design", () => {
    expect(guidedSteps({ locked: true, extras: true })).toEqual(["details", "buttons", "extras", "settings", "share"]);
  });
  it("has no layout step under a page style, which brings its own buttons", () => {
    expect(guidedSteps({ locked: false, extras: true, header: true })).not.toContain("below");
    expect(guidedSteps({ locked: false, extras: true, header: false })).toContain("below");
  });
  it("skips extras when page styles are off", () => {
    expect(guidedSteps({ locked: false, extras: false })).not.toContain("extras");
  });
  it("moves forward and back and stops at the ends", () => {
    const s = guidedSteps({ locked: false, extras: true });
    expect(nextOf(s, "look")).toBe("colour");
    expect(nextOf(s, "share")).toBe("share");
    expect(prevOf(s, "colour")).toBe("look");
    expect(prevOf(s, "look")).toBe("look");
  });
});
