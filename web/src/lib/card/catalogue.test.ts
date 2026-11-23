import { describe, expect, it } from "vitest";
import { PLATFORMS, itemLabel, platformOf, quickActions, visibleItems } from "./catalogue";

describe("platform catalogue", () => {
  it("has the 31 platforms from the contract, each once", () => {
    expect(PLATFORMS).toHaveLength(31);
    expect(new Set(PLATFORMS.map((p) => p.key)).size).toBe(31);
  });
  it("falls back to the custom link for unknown kinds", () => {
    expect(platformOf("Nope").key).toBe("Custom");
  });
  it("uses the owner's label for custom links only", () => {
    expect(itemLabel({ kind: "Custom", label: "Menu" })).toBe("Menu");
    expect(itemLabel({ kind: "Custom", label: "" })).toBe("Link");
    expect(itemLabel({ kind: "Mobile", label: "ignored" })).toBe("Call mobile");
  });
  it("keeps only switched-on items with a value", () => {
    const r = visibleItems([
      { on: true, value: "a" }, { on: false, value: "b" }, { on: true, value: "  " },
    ]);
    expect(r).toHaveLength(1);
  });
  it("takes at most four contact buttons for the quick actions", () => {
    const items = ["Mobile", "Landline", "WhatsApp", "Email", "SMS", "Website"].map((kind) => ({ kind }));
    expect(quickActions(items).map((i) => i.kind)).toEqual(["Mobile", "Landline", "WhatsApp", "Email"]);
  });
});
