// Event mode: "I met someone" notes, the queue that holds them while the phone is offline, and the end-of-event summary.
// Pure logic: storage and the network are passed in, so it is tested without a browser.

export const TAGS = ["hot", "warm", "follow_up"] as const;
export type EventTag = (typeof TAGS)[number] | "";

export type NoteState = "waiting" | "synced" | "rejected";

export interface EventNote {
  /** Made up on the phone; the API uses it to save a retried note only once. */
  ref: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  note: string;
  tag: EventTag;
  eventName: string;
  /** The card that was shown when they met. */
  cardId: string | null;
  workspaceId: string;
  createdAt: number;
  state: NoteState;
  attempts: number;
  /** Earliest time to try sending again (milliseconds since 1970). */
  nextTry: number;
  /** Why a rejected note was refused, or the last network problem. */
  error: string;
}

export interface NoteInput {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  note?: string;
  tag?: EventTag;
  eventName?: string;
  cardId?: string | null;
  workspaceId: string;
}

export type NoteProblem = "empty" | "bad_email";

const clean = (s: string | undefined, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** What is wrong with a note before it is saved, if anything: it needs at least something that says who they are. */
export function noteProblem(input: NoteInput): NoteProblem | null {
  const email = clean(input.email, 254);
  if (email && !EMAIL.test(email)) return "bad_email";
  const any = [input.name, input.company, input.email, input.phone, input.note].some((v) => clean(v, 2000).length > 0);
  return any ? null : "empty";
}

/** A new waiting note from what was typed. `ref` should be unique (a random id). */
export function makeNote(input: NoteInput, ref: string, now: number): EventNote {
  return {
    ref,
    name: clean(input.name, 120),
    company: clean(input.company, 120),
    email: clean(input.email, 254),
    phone: clean(input.phone, 40),
    // A note may use several lines, so only the ends are trimmed.
    note: (input.note ?? "").trim().slice(0, 2000),
    tag: input.tag && (TAGS as readonly string[]).includes(input.tag) ? input.tag : "",
    eventName: clean(input.eventName, 120),
    cardId: input.cardId ?? null,
    workspaceId: input.workspaceId,
    createdAt: now,
    state: "waiting",
    attempts: 0,
    nextTry: 0,
    error: "",
  };
}

/** Two notes with the same words entered within this time are one note tapped twice. */
export const DUPLICATE_WINDOW_MS = 60_000;

const same = (a: EventNote, b: EventNote) =>
  a.workspaceId === b.workspaceId && a.name === b.name && a.company === b.company && a.email === b.email && a.phone === b.phone && a.note === b.note && a.tag === b.tag && a.eventName === b.eventName;

/** Adds a note unless it is already there (same reference) or is a double tap of the previous one. */
export function enqueue(list: EventNote[], note: EventNote): { list: EventNote[]; added: boolean } {
  if (list.some((n) => n.ref === note.ref)) return { list, added: false };
  if (list.some((n) => same(n, note) && Math.abs(note.createdAt - n.createdAt) < DUPLICATE_WINDOW_MS)) return { list, added: false };
  return { list: [...list, note], added: true };
}

/** Seconds to wait after a failed try: 5, 15, 45, ... never more than 5 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(5 * 60_000, 5_000 * 3 ** Math.max(0, attempts - 1));
}

export const waiting = (list: EventNote[]) => list.filter((n) => n.state === "waiting");
export const due = (list: EventNote[], now: number) => waiting(list).filter((n) => n.nextTry <= now);

export type SendResult = { ok: true } | { ok: false; permanent: boolean; error: string };

/** Sends every due note one after another. A refused note is marked rejected (it will never be accepted); a network problem schedules a retry. */
export async function syncDue(list: EventNote[], send: (n: EventNote) => Promise<SendResult>, now: number): Promise<EventNote[]> {
  let out = list;
  for (const n of due(list, now)) {
    const r = await send(n);
    out = out.map((x) => {
      if (x.ref !== n.ref) return x;
      if (r.ok) return { ...x, state: "synced" as const, error: "" };
      if (r.permanent) return { ...x, state: "rejected" as const, error: r.error };
      const attempts = x.attempts + 1;
      return { ...x, attempts, nextTry: now + backoffMs(attempts), error: r.error };
    });
    // The connection is gone: do not hammer it with the rest of the list.
    if (!r.ok && !r.permanent) break;
  }
  return out;
}

/** Puts a rejected note back in the queue (after the person fixed or retried it). */
export function retryRejected(list: EventNote[], ref: string): EventNote[] {
  return list.map((n) => (n.ref === ref && n.state === "rejected" ? { ...n, state: "waiting" as const, attempts: 0, nextTry: 0, error: "" } : n));
}

/** Keeps the list from growing without end: at most `max` notes, dropping the oldest synced ones first. */
export const MAX_NOTES = 500;
export function trim(list: EventNote[], max = MAX_NOTES): EventNote[] {
  if (list.length <= max) return list;
  let extra = list.length - max;
  return list.filter((n) => {
    if (extra > 0 && n.state === "synced") {
      extra -= 1;
      return false;
    }
    return true;
  });
}

export interface EventSummary {
  total: number;
  byTag: Record<"hot" | "warm" | "follow_up" | "none", number>;
  waiting: number;
  rejected: number;
}

/** Counts for one event (by name; empty name means notes with no event name). */
export function summarise(list: EventNote[], eventName: string): EventSummary {
  const mine = list.filter((n) => n.eventName === eventName);
  const byTag = { hot: 0, warm: 0, follow_up: 0, none: 0 };
  for (const n of mine) byTag[n.tag === "" ? "none" : n.tag] += 1;
  return { total: mine.length, byTag, waiting: mine.filter((n) => n.state === "waiting").length, rejected: mine.filter((n) => n.state === "rejected").length };
}

/** The names of events that have notes, newest first. */
export function eventNames(list: EventNote[]): string[] {
  const seen = new Map<string, number>();
  for (const n of list) seen.set(n.eventName, Math.max(seen.get(n.eventName) ?? 0, n.createdAt));
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

/** A cell that a spreadsheet will not run as a formula, quoted when needed. */
export function csvCell(value: string): string {
  let v = value.replace(/\r?\n/g, " ");
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** The CSV of one event's notes, or of every note when `eventName` is null (UTF-8 with a byte-order mark so Excel reads Arabic). `tagName` turns a tag into its words. */
export function toCsv(list: EventNote[], eventName: string | null, tagName: (tag: EventTag) => string, header: string[], labels: { yes: string; no: string } = { yes: "yes", no: "no" }): string {
  const rows = list
    .filter((n) => eventName === null || n.eventName === eventName)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((n) => [new Date(n.createdAt).toISOString(), n.eventName, n.name, n.company, n.email, n.phone, tagName(n.tag), n.note, n.state === "synced" ? labels.yes : labels.no]);
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Turns a note into the body of the lead request. */
export function leadBody(n: EventNote): { name: string; email: string; phone: string; company: string; note: string; card_id?: string; source: "event"; tag: string; event_name: string; client_ref: string } {
  return {
    name: n.name, email: n.email, phone: n.phone, company: n.company, note: n.note, ...(n.cardId ? { card_id: n.cardId } : {}),
    source: "event", tag: n.tag, event_name: n.eventName, client_ref: n.ref,
  };
}

/** Which failures are worth retrying: no answer at all, a busy or failing server, a throttle. Everything else was refused for good. */
export function isTransient(status: number | null): boolean {
  return status === null || status === 0 || status === 408 || status === 429 || status >= 500;
}

// ---- storage (the page's localStorage; every call is safe when it is not available)

const KEY = "bench.event.notes";
const NAME_KEY = "bench.event.name";

const isNote = (v: unknown): v is EventNote => !!v && typeof v === "object" && typeof (v as EventNote).ref === "string" && typeof (v as EventNote).workspaceId === "string" && typeof (v as EventNote).createdAt === "number";

export function loadNotes(storage: Pick<Storage, "getItem"> | null): EventNote[] {
  try {
    const raw = storage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isNote).map((n) => ({ ...makeNote({ ...n, tag: n.tag }, n.ref, n.createdAt), state: n.state === "synced" || n.state === "rejected" ? n.state : "waiting", attempts: Number(n.attempts) || 0, nextTry: Number(n.nextTry) || 0, error: typeof n.error === "string" ? n.error : "" })) : [];
  } catch {
    return [];
  }
}

export function saveNotes(storage: Pick<Storage, "setItem"> | null, list: EventNote[]): void {
  try {
    storage?.setItem(KEY, JSON.stringify(trim(list)));
  } catch {
    /* storage is full or blocked: the notes stay in memory until the page closes */
  }
}

export function loadEventName(storage: Pick<Storage, "getItem"> | null): string {
  try {
    return clean(storage?.getItem(NAME_KEY) ?? "", 120);
  } catch {
    return "";
  }
}

export function saveEventName(storage: Pick<Storage, "setItem"> | null, name: string): void {
  try {
    storage?.setItem(NAME_KEY, clean(name, 120));
  } catch {
    /* not remembered */
  }
}

/** Deletes every saved note (sign-out on a shared phone). */
export function clearNotes(storage: Pick<Storage, "removeItem"> | null): void {
  try {
    storage?.removeItem(KEY);
    storage?.removeItem(NAME_KEY);
  } catch {
    /* nothing to clear */
  }
}
