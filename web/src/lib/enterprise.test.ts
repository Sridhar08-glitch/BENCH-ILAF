import { describe, expect, it } from "vitest";
import { ENTERPRISE_FORM_HREF, hasFeature, quoteTotal } from "./enterprise";
import type { Subscription } from "./types";

const base: Subscription = {
  status: "active", plan_code: "company", seats_total: 5, seats_used: 2, starts_at: null, ends_at: null, grace_ends_at: null, live: true,
};

describe("Enterprise features", () => {
  it("reads the per-feature flags the server sends", () => {
    const sub: Subscription = { ...base, enterprise: false, features: { departments: false, directory: false, activity_log: true } };
    expect(hasFeature(sub, "departments")).toBe(false);
    expect(hasFeature(sub, "activity_log")).toBe(true);
    expect(hasFeature({ ...base, enterprise: true, features: { field_rules: true } }, "field_rules")).toBe(true);
  });

  it("does not lock a screen when the server sent no list (the server still refuses)", () => {
    expect(hasFeature(base, "integrations")).toBe(true);
    expect(hasFeature(undefined, "integrations")).toBe(true);
    expect(hasFeature({ ...base, features: {} }, "sign_in_rules")).toBe(true);
  });

  it("points a locked screen at the quote form on the billing page", () => {
    expect(ENTERPRISE_FORM_HREF).toBe("/app/billing#enterprise");
  });

  it("works out the yearly total of a quote", () => {
    expect(quoteTotal(20, 2500)).toBe(50000);
    expect(quoteTotal(1, 0)).toBe(0);
  });
});
