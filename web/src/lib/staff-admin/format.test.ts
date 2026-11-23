import { describe, expect, it } from "vitest";
import { fmtBytes, fmtClock, fmtDay, fmtDays, fmtMinutes, fmtMs, fmtWhen, humanAction } from "./format";

describe("staff dashboard formatting", () => {
  it("writes sizes", () => {
    expect(fmtBytes(null)).toBe("unknown");
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(fmtBytes(250 * 1024 * 1024)).toBe("250 MB");
  });
  it("writes countdowns in minutes, hours and days, and late ones", () => {
    expect(fmtMinutes(45)).toBe("45 min");
    expect(fmtMinutes(125)).toBe("2 h 5 min");
    expect(fmtMinutes(3 * 1440)).toBe("3 days");
    expect(fmtMinutes(-90)).toBe("late by 1 h 30 min");
    expect(fmtMinutes(null)).toBe("-");
  });
  it("writes the days left of a legal due date", () => {
    expect(fmtDays(3)).toBe("3 days left");
    expect(fmtDays(1)).toBe("1 day left");
    expect(fmtDays(0)).toBe("due today");
    expect(fmtDays(-1)).toBe("1 day overdue");
    expect(fmtDays(-4)).toBe("4 days overdue");
  });
  it("writes the support view clock", () => {
    expect(fmtClock(0)).toBe("00:00");
    expect(fmtClock(1800)).toBe("30:00");
    expect(fmtClock(65.9)).toBe("01:05");
    expect(fmtClock(-5)).toBe("00:00");
  });
  it("writes times in UTC and survives bad input", () => {
    expect(fmtWhen("2026-11-22T14:05:00Z")).toBe("22 Nov 2026, 14:05 UTC");
    expect(fmtDay("2026-11-22T14:05:00Z")).toBe("22 Nov 2026");
    expect(fmtWhen(null)).toBe("-");
    expect(fmtWhen("nonsense")).toBe("-");
  });
  it("writes speeds and action names", () => {
    expect(fmtMs(180)).toBe("180 ms");
    expect(fmtMs(2500)).toBe("2.5 s");
    expect(fmtMs(null)).toBe("-");
    expect(humanAction("support_view.started")).toBe("Support view started");
  });
});
