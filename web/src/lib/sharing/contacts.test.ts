import { describe, expect, it } from "vitest";
import { hasShareSwitch, hintStorageKey, readHintDismissed, shouldShowShareHint, showSharedBadge, writeHintDismissed } from "./contacts";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("the employee sharing switch", () => {
  it("only an employee of a company has it", () => {
    expect(hasShareSwitch("employee", true)).toBe(true);
    expect(hasShareSwitch("admin", true)).toBe(false);
    expect(hasShareSwitch("owner", true)).toBe(false);
    expect(hasShareSwitch("employee", false)).toBe(false);
  });

  it("the badge marks shared contacts for the employee only", () => {
    expect(showSharedBadge({ shared_with_company: true }, "employee", true)).toBe(true);
    expect(showSharedBadge({ shared_with_company: false }, "employee", true)).toBe(false);
    expect(showSharedBadge({}, "employee", true)).toBe(false);
    expect(showSharedBadge({ shared_with_company: true }, "admin", true)).toBe(false);
  });

  it("the one-time hint needs an employee with sharing off who has not dismissed it", () => {
    const base = { role: "employee" as const, isCompany: true, sharing: false, dismissed: false };
    expect(shouldShowShareHint(base)).toBe(true);
    expect(shouldShowShareHint({ ...base, dismissed: true })).toBe(false);
    expect(shouldShowShareHint({ ...base, sharing: true })).toBe(false);
    expect(shouldShowShareHint({ ...base, sharing: undefined })).toBe(false);
    expect(shouldShowShareHint({ ...base, role: "admin" })).toBe(false);
  });

  it("remembers the dismissal per person and company, and survives missing storage", () => {
    const store = memory();
    const key = hintStorageKey("u1", "w1");
    expect(readHintDismissed(key, store)).toBe(false);
    writeHintDismissed(key, store);
    expect(readHintDismissed(key, store)).toBe(true);
    expect(readHintDismissed(hintStorageKey("u1", "w2"), store)).toBe(false);
    expect(readHintDismissed(key, null)).toBe(false);
    expect(() => writeHintDismissed(key, null)).not.toThrow();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readHintDismissed(key, broken)).toBe(false);
    expect(() => writeHintDismissed(key, broken)).not.toThrow();
  });
});
