import { describe, expect, it } from "vitest";
import { FLAG_DEFAULTS, FLAG_KEYS, mergeFlags } from "./flags";

describe("feature switches in the customer app", () => {
  it("every switch is on until the server says otherwise", () => {
    expect(mergeFlags(undefined)).toEqual(FLAG_DEFAULTS);
    expect(FLAG_KEYS.every((k) => FLAG_DEFAULTS[k])).toBe(true);
    expect(FLAG_KEYS).toContain("pack2_faces");
    expect(FLAG_KEYS).toContain("page_styles");
    expect(FLAG_DEFAULTS.page_styles).toBe(true);
  });
  it("takes booleans from the server and ignores everything else", () => {
    const out = mergeFlags({ directory: false, api_keys: "no", wallet_google: null, unknown_switch: false });
    expect(out.directory).toBe(false);
    expect(out.api_keys).toBe(true);
    expect(out.wallet_google).toBe(true);
    expect("unknown_switch" in out).toBe(false);
  });
});
