import { describe, expect, it } from "vitest";
import { BELL_CAP, BELL_POLL_MS, bellBadge, bellInterval, bellItemKey, onContactsPage } from "./leadBell";

describe("bellBadge", () => {
  it("shows nothing when there is no news or the value is not a number", () => {
    expect(bellBadge(0)).toBeNull();
    expect(bellBadge(-3)).toBeNull();
    expect(bellBadge(undefined)).toBeNull();
    expect(bellBadge(null)).toBeNull();
    expect(bellBadge(Number.NaN)).toBeNull();
  });
  it("shows the count as it is up to the cap", () => {
    expect(bellBadge(1)).toEqual({ value: 1, over: false });
    expect(bellBadge(BELL_CAP)).toEqual({ value: 99, over: false });
  });
  it("caps larger counts at 99+", () => {
    expect(bellBadge(100)).toEqual({ value: 99, over: true });
    expect(bellBadge(5000)).toEqual({ value: 99, over: true });
  });
});

describe("bellInterval", () => {
  it("polls once a minute while the tab is visible and the company is open", () => {
    expect(bellInterval(true, false)).toBe(BELL_POLL_MS);
  });
  it("does not poll in a hidden tab or a closed company", () => {
    expect(bellInterval(true, true)).toBe(false);
    expect(bellInterval(false, false)).toBe(false);
  });
});

describe("bellItemKey and onContactsPage", () => {
  it("words a meeting request differently", () => {
    expect(bellItemKey("meeting_request")).toBe("shell.bell.wouldMeet");
    expect(bellItemKey("contact")).toBe("shell.bell.shared");
  });
  it("knows the contacts page", () => {
    expect(onContactsPage("/app/contacts")).toBe(true);
    expect(onContactsPage("/app/contacts/x")).toBe(true);
    expect(onContactsPage("/app/contactsx")).toBe(false);
    expect(onContactsPage("/app/cards")).toBe(false);
  });
});
