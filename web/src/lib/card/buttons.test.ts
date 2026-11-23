import { describe, expect, it } from "vitest";
import {
  BUTTON_GROUPS, MAX_ITEMS, addAnother, canAdd, isShown, moveOn, removeAt, toApiItems, toggleBrand, toggleKind, type Btn,
} from "./buttons";
import { PLATFORMS, visibleItems } from "./catalogue";

const item = (kind: Btn["kind"], value = "", on = true): Btn => ({ kind, value, label: "", on });

describe("switch groups", () => {
  it("cover every platform except the custom link, once", () => {
    const kinds = BUTTON_GROUPS.flatMap((g) => g.kinds);
    expect(kinds).toHaveLength(31);
    expect(new Set(kinds).size).toBe(31);
    expect(kinds).not.toContain("Custom");
    expect(kinds).toContain("Meeting");
    expect(PLATFORMS.filter((p) => p.key !== "Custom").every((p) => kinds.includes(p.key))).toBe(true);
  });
});

describe("toggle a platform", () => {
  it("on creates an empty item when there is none", () => {
    const r = toggleKind([], "GitHub", true);
    expect(r).toEqual([{ kind: "GitHub", value: "", label: "", on: true }]);
  });
  it("on re-enables the existing item and keeps its value", () => {
    const r = toggleKind([item("GitHub", "github.com/me", false)], "GitHub", true);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ value: "github.com/me", on: true });
  });
  it("off hides the item but keeps what was typed", () => {
    const r = toggleKind([item("GitHub", "github.com/me")], "GitHub", false);
    expect(r[0]).toMatchObject({ value: "github.com/me", on: false });
  });
  it("off then on brings the same value back", () => {
    const start = [item("Instagram", "@me")];
    const back = toggleKind(toggleKind(start, "Instagram", false), "Instagram", true);
    expect(back).toEqual(start);
  });
  it("off hides every item of that kind", () => {
    const r = toggleKind([item("Mobile", "1"), item("Mobile", "2"), item("Email", "a@b.c")], "Mobile", false);
    expect(r.map((i) => i.on)).toEqual([false, false, true]);
  });
  it("an item with an empty value is switched on but not shown on the card", () => {
    const r = toggleKind([], "GitHub", true);
    expect(isShown(r[0])).toBe(false);
    expect(visibleItems(r)).toHaveLength(0);
    expect(visibleItems([{ ...r[0], value: "github.com/me" }])).toHaveLength(1);
  });
  it("does not add past the 40-button limit", () => {
    const full = Array.from({ length: MAX_ITEMS }, (_, i) => item("Custom", `x${i}.com`));
    expect(canAdd(full)).toBe(false);
    expect(toggleKind(full, "GitHub", true)).toHaveLength(MAX_ITEMS);
    expect(addAnother(full, "Custom")).toHaveLength(MAX_ITEMS);
  });
});

describe("add another and brands", () => {
  it("puts the second item right after the last of its kind", () => {
    const r = addAnother([item("Mobile", "1"), item("Email", "a@b.c")], "Mobile");
    expect(r.map((i) => i.kind)).toEqual(["Mobile", "Mobile", "Email"]);
    expect(r[1].on).toBe(true);
  });
  it("a brand not in the list becomes a custom item with that logo", () => {
    const r = toggleBrand([], "stripe", "Stripe", true);
    expect(r[0]).toMatchObject({ kind: "Custom", label: "Stripe", on: true, icon: { type: "brand", key: "stripe" } });
  });
  it("switching a brand off keeps it and on again restores the same item", () => {
    const a = toggleBrand([{ ...toggleBrand([], "stripe", "Stripe", true)[0], value: "stripe.com/me" }], "stripe", "Stripe", false);
    expect(a[0]).toMatchObject({ on: false, value: "stripe.com/me" });
    const b = toggleBrand(a, "stripe", "Stripe", true);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ on: true, value: "stripe.com/me" });
  });
  it("brand items do not count as the plain Custom row", () => {
    const withBrand = toggleBrand([], "stripe", "Stripe", true);
    expect(toggleKind(withBrand, "Custom", true)).toHaveLength(2);
  });
});

describe("order", () => {
  it("moves a switched-on button past hidden ones", () => {
    const items = [item("Mobile", "1"), item("Email", "a@b.c", false), item("Website", "x.com")];
    const r = moveOn(items, 2, -1);
    expect(r.map((i) => i.kind)).toEqual(["Website", "Email", "Mobile"]);
  });
  it("does nothing at the ends", () => {
    const items = [item("Mobile", "1"), item("Website", "x.com")];
    expect(moveOn(items, 0, -1)).toBe(items);
    expect(moveOn(items, 1, 1)).toBe(items);
  });
  it("removes an item", () => {
    expect(removeAt([item("Mobile"), item("Email")], 0).map((i) => i.kind)).toEqual(["Email"]);
  });
});

describe("what goes to the API", () => {
  it("trims values and cuts labels to 40 characters", () => {
    const r = toApiItems([{ kind: "Custom", value: " a.com ", label: "x".repeat(60), on: true }]);
    expect(r[0].value).toBe("a.com");
    expect(r[0].label).toHaveLength(40);
    expect(r[0].icon).toBeNull();
  });
});
