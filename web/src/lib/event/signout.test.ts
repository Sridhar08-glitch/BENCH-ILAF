import { describe, expect, it } from "vitest";
import { makeNote, saveNotes, type EventNote } from "./notes";
import { signOutStep, unsentCount, unsentCsv, unsentFileName, unsentNotes } from "./signout";

const note = (over: Partial<EventNote> = {}, ref = "r1"): EventNote => ({ ...makeNote({ workspaceId: "w", name: "Omar", eventName: "Expo" }, ref, 1000), ...over });

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("unsent notes at sign-out", () => {
  it("counts waiting and refused notes, not the ones already sent", () => {
    const list = [note({}, "a"), note({ state: "synced" }, "b"), note({ state: "rejected" }, "c")];
    expect(unsentNotes(list).map((n) => n.ref)).toEqual(["a", "c"]);
  });

  it("reads the count from the device storage, and is 0 when there is none", () => {
    const s = memory();
    expect(unsentCount(s)).toBe(0);
    saveNotes(s, [note({}, "a"), note({ state: "synced" }, "b")]);
    expect(unsentCount(s)).toBe(1);
    expect(unsentCount(null)).toBe(0);
  });

  it("signs out at once with nothing to lose, and asks otherwise", () => {
    expect(signOutStep(0)).toBe("now");
    expect(signOutStep(1)).toBe("ask");
    expect(signOutStep(12)).toBe("ask");
  });

  it("exports every unsent note of every event in one file, and only those", () => {
    const list = [note({ name: "Kept" }, "a"), note({ name: "Other", eventName: "Summit", createdAt: 2000 }, "b"), note({ name: "Sent", state: "synced" }, "c")];
    const csv = unsentCsv(list, (t) => t, ["time", "event", "name"], { yes: "yes", no: "no" });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Kept");
    expect(csv).toContain("Other");
    expect(csv).not.toContain("Sent");
    expect(csv.trim().split("\r\n")).toHaveLength(3);
  });

  it("names the file with the day", () => {
    expect(unsentFileName("unsent-event-notes", new Date("2026-11-23T10:00:00Z"))).toBe("unsent-event-notes-2026-11-23.csv");
  });
});
