import { describe, expect, it } from "vitest";
import {
  DUPLICATE_WINDOW_MS, MAX_NOTES, backoffMs, clearNotes, csvCell, due, enqueue, eventNames, isTransient, leadBody, loadEventName, loadNotes, makeNote, noteProblem,
  retryRejected, saveEventName, saveNotes, summarise, syncDue, toCsv, trim, waiting, type EventNote, type SendResult,
} from "./notes";

const WS = "ws1";
const note = (over: Partial<Parameters<typeof makeNote>[0]> = {}, ref = "r1", at = 1000): EventNote => makeNote({ workspaceId: WS, name: "Omar", ...over }, ref, at);

describe("noteProblem", () => {
  it("needs something that says who they are", () => {
    expect(noteProblem({ workspaceId: WS })).toBe("empty");
    expect(noteProblem({ workspaceId: WS, name: "  " })).toBe("empty");
    expect(noteProblem({ workspaceId: WS, tag: "hot", eventName: "Expo" })).toBe("empty");
    expect(noteProblem({ workspaceId: WS, note: "tall, blue jacket" })).toBeNull();
    expect(noteProblem({ workspaceId: WS, phone: "+974 5555 0000" })).toBeNull();
  });
  it("checks the e-mail address", () => {
    expect(noteProblem({ workspaceId: WS, name: "A", email: "nope" })).toBe("bad_email");
    expect(noteProblem({ workspaceId: WS, email: "a@b.co" })).toBeNull();
  });
});

describe("makeNote", () => {
  it("cleans spaces, limits lengths and keeps note lines", () => {
    const n = makeNote({ workspaceId: WS, name: "  Omar   Ali ", note: "line 1\nline 2 ", tag: "hot", eventName: " Expo  2027 ", cardId: "c1" }, "r", 5);
    expect(n).toMatchObject({ name: "Omar Ali", note: "line 1\nline 2", tag: "hot", eventName: "Expo 2027", cardId: "c1", state: "waiting", attempts: 0, createdAt: 5 });
    expect(makeNote({ workspaceId: WS, name: "x".repeat(500) }, "r", 1).name).toHaveLength(120);
  });
  it("ignores an unknown tag", () => {
    expect(makeNote({ workspaceId: WS, name: "A", tag: "cold" as never }, "r", 1).tag).toBe("");
  });
});

describe("enqueue", () => {
  it("adds a new note and refuses the same reference again", () => {
    const a = enqueue([], note());
    expect(a.added).toBe(true);
    const b = enqueue(a.list, note({ name: "Different" }, "r1", 9999));
    expect(b.added).toBe(false);
    expect(b.list).toHaveLength(1);
  });
  it("treats the same words within a minute as a double tap, but not later or for someone else", () => {
    const first = enqueue([], note({}, "r1", 1000)).list;
    expect(enqueue(first, note({}, "r2", 1000 + DUPLICATE_WINDOW_MS - 1)).added).toBe(false);
    expect(enqueue(first, note({}, "r3", 1000 + DUPLICATE_WINDOW_MS)).added).toBe(true);
    expect(enqueue(first, note({ name: "Sara" }, "r4", 1001)).added).toBe(true);
    expect(enqueue(first, note({ tag: "hot" }, "r5", 1001)).added).toBe(true);
  });
});

describe("backoff", () => {
  it("grows and stops at five minutes", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([5000, 15000, 45000]);
    expect(backoffMs(20)).toBe(300000);
    expect(backoffMs(0)).toBe(5000);
  });
});

describe("syncDue", () => {
  const ok: SendResult = { ok: true };
  it("marks sent notes as synced and keeps the order", async () => {
    const list = [note({}, "a", 1), note({ name: "B" }, "b", 2)];
    const sent: string[] = [];
    const out = await syncDue(list, async (n) => (sent.push(n.ref), ok), 100);
    expect(sent).toEqual(["a", "b"]);
    expect(out.map((n) => n.state)).toEqual(["synced", "synced"]);
    expect(waiting(out)).toHaveLength(0);
  });
  it("schedules a retry on a network problem and stops sending the rest", async () => {
    const list = [note({}, "a", 1), note({ name: "B" }, "b", 2)];
    const sent: string[] = [];
    const out = await syncDue(list, async (n) => (sent.push(n.ref), { ok: false, permanent: false, error: "offline" }), 1000);
    expect(sent).toEqual(["a"]);
    expect(out[0]).toMatchObject({ state: "waiting", attempts: 1, nextTry: 1000 + 5000, error: "offline" });
    expect(out[1].attempts).toBe(0);
    expect(due(out, 2000)).toHaveLength(1);
    expect(due(out, 7000)).toHaveLength(2);
  });
  it("rejects a note the server refused for good and goes on with the next", async () => {
    const list = [note({}, "a", 1), note({ name: "B" }, "b", 2)];
    const out = await syncDue(list, async (n) => (n.ref === "a" ? { ok: false, permanent: true, error: "Enter a valid email address." } : ok), 100);
    expect(out.map((n) => n.state)).toEqual(["rejected", "synced"]);
    expect(out[0].error).toBe("Enter a valid email address.");
    expect(retryRejected(out, "a")[0]).toMatchObject({ state: "waiting", attempts: 0, error: "" });
    expect(retryRejected(out, "b")[1].state).toBe("synced");
  });
  it("sends a retried note under the same reference, so the API saves it once", async () => {
    let calls = 0;
    const refs: string[] = [];
    const send = async (n: EventNote): Promise<SendResult> => {
      refs.push(leadBody(n).client_ref);
      return ++calls === 1 ? { ok: false, permanent: false, error: "x" } : { ok: true };
    };
    let list = [note({}, "same-ref", 1)];
    list = await syncDue(list, send, 0);
    list = await syncDue(list, send, 10_000);
    expect(refs).toEqual(["same-ref", "same-ref"]);
    expect(list[0].state).toBe("synced");
  });
  it("skips notes that are not due yet", async () => {
    const list = [{ ...note(), nextTry: 5000 }];
    const out = await syncDue(list, async () => ok, 1000);
    expect(out[0].state).toBe("waiting");
  });
});

describe("transient failures", () => {
  it("retries no answer, throttling and server errors only", () => {
    expect([null, 0, 408, 429, 500, 502, 503].every(isTransient)).toBe(true);
    expect([400, 401, 403, 404, 409, 422].some(isTransient)).toBe(false);
  });
});

describe("lead body", () => {
  it("is a lead with the event source, tag, event name and reference", () => {
    expect(leadBody(note({ tag: "warm", eventName: "Expo", cardId: "c9", email: "a@b.co" }, "ref-1"))).toEqual({
      name: "Omar", email: "a@b.co", phone: "", company: "", note: "", card_id: "c9", source: "event", tag: "warm", event_name: "Expo", client_ref: "ref-1",
    });
    expect(leadBody(note({ cardId: null }, "r")).card_id).toBeUndefined();
  });
});

describe("summary", () => {
  const list = [
    note({ tag: "hot", eventName: "Expo" }, "1", 1), note({ name: "B", tag: "hot", eventName: "Expo" }, "2", 2), note({ name: "C", tag: "follow_up", eventName: "Expo" }, "3", 3),
    note({ name: "D", eventName: "Expo" }, "4", 4), note({ name: "E", tag: "warm", eventName: "Other" }, "5", 5),
  ];
  it("counts by tag for one event", () => {
    expect(summarise(list, "Expo")).toEqual({ total: 4, byTag: { hot: 2, warm: 0, follow_up: 1, none: 1 }, waiting: 4, rejected: 0 });
    expect(summarise(list, "Nothing").total).toBe(0);
  });
  it("lists events newest first", () => {
    expect(eventNames(list)).toEqual(["Other", "Expo"]);
  });
});

describe("csv", () => {
  it("escapes quotes, commas and formulas, and starts with a byte-order mark", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("line1\nline2")).toBe("line1 line2");
  });
  it("writes one row per note of the event", () => {
    const list = [note({ name: "Omar", tag: "hot", eventName: "Expo", note: "a, b" }, "1", Date.UTC(2027, 0, 5)), note({ name: "Other", eventName: "Else" }, "2", 1)];
    const csv = toCsv(list, "Expo", (t) => (t === "hot" ? "Hot" : ""), ["time", "event", "name", "company", "email", "phone", "tag", "note", "synced"]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('2027-01-05T00:00:00.000Z,Expo,Omar,,,,Hot,"a, b",no');
  });
});

describe("trim", () => {
  it("drops the oldest synced notes first and never a waiting one", () => {
    const list = Array.from({ length: 5 }, (_, i) => ({ ...note({ name: `N${i}` }, `r${i}`, i), state: i < 3 ? ("synced" as const) : ("waiting" as const) }));
    expect(trim(list, 4).map((n) => n.ref)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(trim(list, 2).map((n) => n.ref)).toEqual(["r3", "r4"]);
    expect(MAX_NOTES).toBeGreaterThan(100);
  });
});

describe("storage", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  it("saves and loads notes with their state", () => {
    const s = mem();
    saveNotes(s, [{ ...note({ tag: "hot" }, "a", 5), state: "synced", attempts: 2, nextTry: 9 }]);
    expect(loadNotes(s)[0]).toMatchObject({ ref: "a", tag: "hot", state: "synced", attempts: 2, nextTry: 9 });
  });
  it("survives broken or missing storage", () => {
    const s = mem();
    s.setItem("bench.event.notes", "not json");
    expect(loadNotes(s)).toEqual([]);
    s.setItem("bench.event.notes", JSON.stringify([{ nope: 1 }, "x"]));
    expect(loadNotes(s)).toEqual([]);
    expect(loadNotes(null)).toEqual([]);
    expect(() => saveNotes(null, [])).not.toThrow();
    expect(() => saveNotes({ setItem: () => { throw new Error("full"); } }, [note()])).not.toThrow();
  });
  it("remembers the event name and clears everything", () => {
    const s = mem();
    saveEventName(s, "  Expo   2027 ");
    expect(loadEventName(s)).toBe("Expo 2027");
    saveNotes(s, [note()]);
    clearNotes(s);
    expect(loadNotes(s)).toEqual([]);
    expect(loadEventName(s)).toBe("");
  });
});
