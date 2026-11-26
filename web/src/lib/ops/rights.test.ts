import { describe, expect, it } from "vitest";
import type { FieldRules } from "../types";
import { allowedExtras, extrasOf, presetOf, presetRules, ruleChanges, withExtras } from "./fields";
import { EXTRA_KINDS } from "../types";

const free: FieldRules = {
  name: "free", title: "free", photo: "free", company: "free", address: "free", slug: "free", features: "free", vcard: "free",
  button_add: "free", button_edit: "free", button_remove: "free", allowed_kinds: null, banned_domains: [], mandatory_buttons: [], extras: "all", extra_kinds: ["video", "products", "hours", "booking", "team", "gallery", "event", "map"],
};

describe("how much people can change, as one choice", () => {
  it("anything: every permission is free", () => {
    expect(presetRules("free", { ...free, name: "locked" })).toEqual(free);
  });

  it("changes need approval: the person's details wait for an admin, the settings stay free", () => {
    const r = presetRules("approval", free);
    expect([r.name, r.title, r.photo, r.company, r.address]).toEqual(["approval", "approval", "approval", "approval", "approval"]);
    expect([r.slug, r.features, r.vcard, r.button_add, r.button_edit, r.button_remove]).toEqual(["free", "free", "free", "free", "free", "free"]);
  });

  it("nothing: everything is locked", () => {
    const r = presetRules("locked", free);
    expect(Object.values({ ...r, allowed_kinds: 0, banned_domains: 0, mandatory_buttons: 0 }).filter((v) => v === "locked")).toHaveLength(11);
  });

  it("keeps the allowed button kinds, the banned domains and the required buttons", () => {
    const own: FieldRules = { ...free, allowed_kinds: ["Email"], banned_domains: ["bad.example"], mandatory_buttons: [{ kind: "Email", value: "a@b.co", label: "" }] };
    const r = presetRules("locked", own);
    expect(r.allowed_kinds).toEqual(["Email"]);
    expect(r.banned_domains).toEqual(["bad.example"]);
    expect(r.mandatory_buttons).toHaveLength(1);
  });

  it("knows which choice the saved rules match, or none when they were set one by one", () => {
    expect(presetOf(free)).toBe("free");
    expect(presetOf(presetRules("approval", free))).toBe("approval");
    expect(presetOf(presetRules("locked", free))).toBe("locked");
    expect(presetOf({ ...free, photo: "locked" })).toBeNull();
  });

  it("sends only what changes", () => {
    expect(Object.keys(ruleChanges(free, presetRules("approval", free))).sort()).toEqual(["address", "company", "name", "photo", "title"]);
    expect(ruleChanges(free, free)).toEqual({});
  });
});

describe("what extras people may add", () => {
  it("allows every extra when the API says nothing", () => {
    expect(allowedExtras(undefined)).toEqual([...EXTRA_KINDS]);
    expect(allowedExtras({})).toEqual([...EXTRA_KINDS]);
    expect(allowedExtras({ extras: ["map"] })).toEqual(["map"]);
    expect(allowedExtras({ extras: [] })).toEqual([]);
  });

  it("reads the company's choice: all, some or none", () => {
    expect(extrasOf({ extras: "all", extra_kinds: ["map"] })).toEqual([...EXTRA_KINDS]);
    expect(extrasOf({ extras: "some", extra_kinds: ["map", "hours"] })).toEqual(["hours", "map"]);
    expect(extrasOf({ extras: "none", extra_kinds: ["map"] })).toEqual([]);
  });

  it("changes the choice and keeps the kinds in a fixed order, sending only that", () => {
    const next = withExtras(free, "some", ["map", "video"]);
    expect(next.extras).toBe("some");
    expect(next.extra_kinds).toEqual(["video", "map"]);
    expect(Object.keys(ruleChanges(free, next)).sort()).toEqual(["extra_kinds", "extras"]);
    expect(withExtras(next, "none").extra_kinds).toEqual(["video", "map"]);
  });
});
