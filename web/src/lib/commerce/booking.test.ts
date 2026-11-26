import { describe, expect, it } from "vitest";
import { addDays, dayLabel, minutes, openDays, replaceWindow, slotLabel, todayIn, weeklyProblem, windowsOf, withWindow, withoutWindow } from "./booking";

describe("opening windows", () => {
  it("reads clock times", () => {
    expect(minutes("09:30")).toBe(570);
    expect(minutes("9:05")).toBe(545);
    expect(minutes("24:00")).toBeNull();
    expect(minutes("nine")).toBeNull();
  });
  it("accepts good windows and finds the first mistake", () => {
    expect(weeklyProblem([{ d: 0, from: "09:00", to: "12:00" }, { d: 0, from: "13:00", to: "17:00" }])).toBeNull();
    expect(weeklyProblem([{ d: 1, from: "12:00", to: "09:00" }])).toEqual({ kind: "order", d: 1 });
    expect(weeklyProblem([{ d: 2, from: "09:00", to: "12:00" }, { d: 2, from: "11:00", to: "14:00" }])).toEqual({ kind: "overlap", d: 2 });
    expect(weeklyProblem([{ d: 3, from: "", to: "12:00" }])).toEqual({ kind: "time", d: 3 });
  });
  it("lets two windows touch without overlapping", () => {
    expect(weeklyProblem([{ d: 0, from: "09:00", to: "12:00" }, { d: 0, from: "12:00", to: "15:00" }])).toBeNull();
  });
  it("adds a window after the day's last one, and removes or edits one", () => {
    let w = withWindow([], 0);
    expect(windowsOf(w, 0)).toEqual([{ d: 0, from: "09:00", to: "11:00" }]);
    w = withWindow(w, 0);
    expect(windowsOf(w, 0)[1]).toEqual({ d: 0, from: "11:00", to: "13:00" });
    w = replaceWindow(w, 0, 1, { to: "18:00" });
    expect(windowsOf(w, 0)[1].to).toBe("18:00");
    w = withoutWindow(w, 0, 0);
    expect(windowsOf(w, 0)).toEqual([{ d: 0, from: "11:00", to: "18:00" }]);
    expect(withoutWindow(w, 0, 9)).toEqual(w);
  });
});

describe("the visitor's calendar", () => {
  it("names today in the card's time zone", () => {
    const t = new Date("2027-01-05T22:30:00Z");
    expect(todayIn("Asia/Qatar", t)).toBe("2027-01-06");
    expect(todayIn("UTC", t)).toBe("2027-01-05");
  });
  it("moves a date by whole days across month ends", () => {
    expect(addDays("2027-01-31", 1)).toBe("2027-02-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
  });
  it("keeps only the days that have a free time", () => {
    expect(openDays([{ date: "a", slots: [] }, { date: "b", slots: ["09:00"] }]).map((d) => d.date)).toEqual(["b"]);
  });
  it("writes dates and times in the visitor's language", () => {
    expect(dayLabel("2027-01-05", "en")).toContain("5");
    expect(dayLabel("bad", "en")).toBe("bad");
    expect(slotLabel("14:30", "en")).toMatch(/2:30/);
    expect(slotLabel("oops", "en")).toBe("oops");
  });
});
