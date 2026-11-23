import { afterEach, describe, expect, it } from "vitest";
import { clearThrottle, noteThrottle, parseRetryAfter, secondsLeft } from "./throttle";

afterEach(() => clearThrottle());

describe("waiting after a 429", () => {
  it("reads Retry-After as seconds or as a date, with a fallback", () => {
    expect(parseRetryAfter("45")).toBe(45);
    expect(parseRetryAfter("0")).toBe(1);
    expect(parseRetryAfter("999999")).toBe(3600);
    expect(parseRetryAfter(null)).toBe(30);
    expect(parseRetryAfter("soon")).toBe(30);
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:20 GMT", 30, now)).toBe(20);
  });

  it("counts down the time left and never goes below zero", () => {
    expect(secondsLeft()).toBe(0);
    noteThrottle(12);
    expect(secondsLeft()).toBeGreaterThan(10);
    expect(secondsLeft()).toBeLessThanOrEqual(12);
    expect(secondsLeft(Date.now() + 60_000)).toBe(0);
  });

  it("keeps the longest wait", () => {
    noteThrottle(60);
    noteThrottle(5);
    expect(secondsLeft()).toBeGreaterThan(50);
  });
});
