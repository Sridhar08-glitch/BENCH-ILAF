import { describe, expect, it } from "vitest";
import { SLA_TONE, activeDeadline, formatDuration, timeToDue } from "./format";

describe("durations and deadlines", () => {
  it("writes durations short", () => {
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(35 * 60)).toBe("35m");
    expect(formatDuration(2 * 3600 + 5 * 60)).toBe("2h 05m");
    expect(formatDuration(3 * 86400 + 4 * 3600)).toBe("3d 4h");
  });
  it("counts the time left or overdue", () => {
    const now = Date.parse("2026-11-22T10:00:00Z");
    expect(timeToDue("2026-11-22T11:20:00Z", now)).toEqual({ text: "1h 20m", late: false });
    expect(timeToDue("2026-11-22T09:25:00Z", now)).toEqual({ text: "35m", late: true });
    expect(timeToDue(null, now)).toBeNull();
  });
  it("measures against the first reply until it is sent, then the resolution", () => {
    const t = { first_response_at: null, first_due_at: "a", resolve_due_at: "b" };
    expect(activeDeadline(t)).toBe("a");
    expect(activeDeadline({ ...t, first_response_at: "x" })).toBe("b");
  });
  it("colours the states", () => {
    expect(SLA_TONE).toEqual({ ok: "ok", at_risk: "warn", breached: "bad", paused: "plain", done: "plain" });
  });
});
