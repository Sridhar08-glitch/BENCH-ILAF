import { describe, expect, it } from "vitest";
import { buildEntries, firstOf, groupOf, quickEntries, splitName } from "./entries";

const items = [
  { kind: "Mobile", value: "+971 50 669 8770", on: true },
  { kind: "WhatsApp", value: "+971 50 669 8770", on: true },
  { kind: "Email", value: "info@x.com", on: true },
  { kind: "Instagram", value: "@jas", on: true },
  { kind: "Website", value: "x.com", on: true },
  { kind: "Custom", value: "javascript:alert(1)", label: "Bad", on: true },
  { kind: "GitHub", value: "gh", on: false },
  { kind: "Facebook", value: "  ", on: true },
];

describe("entries for the details area", () => {
  const e = buildEntries(items, "");
  it("keeps only switched-on buttons with a value", () => {
    expect(e.map((x) => x.kind)).toEqual(["Mobile", "WhatsApp", "Email", "Instagram", "Website", "Custom"]);
  });
  it("builds real links and disables unsafe ones", () => {
    expect(e[0].href).toBe("tel:+971506698770");
    expect(e[3].href).toBe("https://instagram.com/jas");
    expect(e[5].href).toBeNull();
  });
  it("groups contact, social and web", () => {
    expect(groupOf("Mobile")).toBe("c");
    expect(groupOf("Instagram")).toBe("s");
    expect(groupOf("Website")).toBe("w");
    expect(groupOf("Custom")).toBe("w");
  });
  it("adds the address as a directions entry that opens maps", () => {
    const withAddr = buildEntries(items, "Deira, Dubai");
    const last = withAddr[withAddr.length - 1];
    expect(last.kind).toBe("Location");
    expect(last.href).toContain("google.com/maps");
    expect(buildEntries([{ kind: "Location", value: "Deira", on: true }], "Deira, Dubai")).toHaveLength(1);
  });
  it("finds quick actions and the first of a kind", () => {
    expect(quickEntries(e).map((x) => x.kind)).toEqual(["Mobile", "WhatsApp", "Email"]);
    expect(firstOf(e, "Landline", "Mobile")?.kind).toBe("Mobile");
    expect(firstOf(e, "Landline")).toBeUndefined();
  });
  it("splits names", () => {
    expect(splitName("Jasir Vadakkedath Khan")).toEqual({ first: "Jasir", last: "Vadakkedath Khan" });
    expect(splitName("Sara")).toEqual({ first: "Sara", last: "" });
  });
});
