import { describe, expect, it } from "vitest";
import { extrasWords, logoWords, rightsWords } from "./company-page";

describe("company page words for the Bench team", () => {
  it("says what employees may add", () => {
    expect(extrasWords(undefined)).toBe("Any extra");
    expect(extrasWords({ mode: "all", kinds: [] })).toBe("Any extra");
    expect(extrasWords({ mode: "none", kinds: ["map"] })).toBe("None");
    expect(extrasWords({ mode: "some", kinds: ["map", "hours"] })).toBe("Only: Map, Opening hours");
    expect(extrasWords({ mode: "some", kinds: [] })).toBe("None");
  });

  it("describes how the logo is shown, with its size and the places the owner chose", () => {
    expect(logoWords({})).toBe("Automatic, Above the card and on it, corner: Automatic, size 100%");
    expect(logoWords({ logo_display: "symbol_name", logo_placement: "card", logo_corner: "tr", logo_size: 80, logo_free: { f1: {}, t3: {} } })).toBe(
      "Symbol and name, On the card, corner: Top right, size 80%, placed by the owner on 2 designs",
    );
    expect(logoWords({ logo_free: { f1: {} } })).toContain("on 1 design");
  });

  it("counts the rights employees have", () => {
    expect(rightsWords(undefined)).toBe("-");
    expect(rightsWords({ name: "free", title: "free", photo: "locked", company: "approval" })).toBe("2 free, 1 locked, 1 needs approval");
  });
});
