// Pure helpers of the sections under a card: ordering, opening-hours maths, the countdown, prices and the calendar
// file. No React and no browser globals, so the same code runs on the server, in the browser and in tests.
import { SECTION_KINDS, type EventSectionData, type HoursDay, type PublicProduct, type PublicSection, type SectionKind } from "@/lib/public-api";

/** The sections to draw, in the owner's order; anything the page cannot draw (unknown kind, no data) is left out. */
export function orderSections(sections: readonly PublicSection[] | null | undefined): PublicSection[] {
  if (!Array.isArray(sections)) return [];
  const known = new Set<string>(SECTION_KINDS);
  return sections
    .filter((s) => s && known.has(s.kind) && s.data && typeof s.data === "object")
    .slice()
    .sort((a, b) => a.order - b.order || SECTION_KINDS.indexOf(a.kind) - SECTION_KINDS.indexOf(b.kind));
}

/** The products of a products section: the API may spell the expanded list as `items` or `products`. */
export function productsOf(data: { items?: PublicProduct[]; products?: PublicProduct[] } | null | undefined): PublicProduct[] {
  const list = data?.items ?? data?.products;
  return Array.isArray(list) ? list.filter((p) => p && typeof p === "object" && p.id) : [];
}

// ---------------------------------------------------------------- opening hours

/** Day numbers count from Monday (0) to Sunday (6), as the API stores them. */
export const WEEK: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/** "HH:MM" as minutes after midnight; null when the text is not a time. */
export function minutesOf(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** The local day (Monday = 0) and minutes since midnight at an instant, in a time zone. An unknown zone reads as UTC. */
export function localClock(timezone: string, now: Date): { day: number; minutes: number; timezone: string } {
  let zone = timezone;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch {
    zone = "UTC";
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  const parts = fmt.formatToParts(now);
  const read = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = WEEKDAY_INDEX[read("weekday")] ?? 0;
  const hour = Number(read("hour")) % 24;
  return { day, minutes: hour * 60 + Number(read("minute")), timezone: zone };
}

/** The row of one day, or a closed row when the owner never set it. */
export function dayOf(days: readonly HoursDay[] | null | undefined, d: number): HoursDay {
  const row = Array.isArray(days) ? days.find((x) => x && x.d === d) : undefined;
  return row ?? { d, open: "", close: "", closed: true };
}

export interface OpenState {
  /** Open at this moment. */
  open: boolean;
  /** Today's row in the section's time zone. */
  today: HoursDay;
  /** "HH:MM" today when the place opens later today, or null. */
  opensAt: string | null;
  /** "HH:MM" when the place closes today (only while open). */
  closesAt: string | null;
}

/** Whether a place is open at `now`, read in the section's own time zone. A row that closes after midnight ("22:00" to
 * "02:00") counts as open until two in the morning of the next day. */
export function openState(days: readonly HoursDay[], timezone: string, now: Date): OpenState {
  const clock = localClock(timezone, now);
  const today = dayOf(days, clock.day);
  const yesterday = dayOf(days, (clock.day + 6) % 7);
  const times = (row: HoursDay): [number, number] | null => {
    if (row.closed) return null;
    const o = minutesOf(row.open);
    const c = minutesOf(row.close);
    return o === null || c === null || o === c ? null : [o, c];
  };
  // A late night from yesterday is still running: its closing time is past midnight and not reached yet.
  const y = times(yesterday);
  if (y && y[1] < y[0] && clock.minutes < y[1]) return { open: true, today, opensAt: null, closesAt: yesterday.close };
  const td = times(today);
  // Today's own window: up to its closing time, or up to midnight when it closes after midnight.
  if (td && clock.minutes >= td[0] && (td[1] > td[0] ? clock.minutes < td[1] : true)) return { open: true, today, opensAt: null, closesAt: today.close };
  const o = minutesOf(today.open);
  const opensLater = !today.closed && o !== null && o > clock.minutes;
  return { open: false, today, opensAt: opensLater ? today.open : null, closesAt: null };
}

export interface HoursRange { from: number; to: number; open: string; close: string; closed: boolean }

/** Consecutive days with the same hours shown as one line ("Sunday to Thursday"), the week starting on Monday. */
export function groupDays(days: readonly HoursDay[]): HoursRange[] {
  const out: HoursRange[] = [];
  for (const d of WEEK) {
    const row = dayOf(days, d);
    const last = out[out.length - 1];
    const same = last && last.to === d - 1 && last.closed === row.closed && (row.closed || (last.open === row.open && last.close === row.close));
    if (same) last.to = d;
    else out.push({ from: d, to: d, open: row.open, close: row.close, closed: row.closed });
  }
  return out;
}

/** The name of a weekday (Monday = 0) in a language. */
export function dayName(d: number, locale: string, style: "long" | "short" = "long"): string {
  // The first of January 2024 was a Monday.
  const date = new Date(Date.UTC(2024, 0, 1 + (((d % 7) + 7) % 7), 12));
  try {
    return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", { weekday: style, timeZone: "UTC" }).format(date);
  }
}

/** The default week: open nine to six on weekdays, closed on Saturday and Sunday. */
export function defaultDays(): HoursDay[] {
  return WEEK.map((d) => ({ d, open: "09:00", close: "18:00", closed: d >= 5 }));
}

/** The offset of a time zone from UTC at an instant, as "+03:00", or "" for an unknown zone. */
export function zoneOffset(timezone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(now);
    const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    return raw === "GMT" ? "+00:00" : raw.replace("GMT", "");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- countdown

export interface CountdownParts {
  /** before: counting down; live: between start and end (or within the start day when there is no end); ended. */
  state: "before" | "live" | "ended";
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function countdownParts(startsAt: string, endsAt: string | null | undefined, now: Date): CountdownParts {
  const start = Date.parse(startsAt);
  if (Number.isNaN(start)) return { state: "ended", days: 0, hours: 0, minutes: 0, seconds: 0 };
  const left = start - now.getTime();
  if (left > 0) {
    const s = Math.floor(left / 1000);
    return { state: "before", days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
  }
  const endRaw = endsAt ? Date.parse(endsAt) : NaN;
  // Without an end the event is live for a day after it starts.
  const end = Number.isNaN(endRaw) ? start + 24 * 3600_000 : endRaw;
  return { state: now.getTime() < end ? "live" : "ended", days: 0, hours: 0, minutes: 0, seconds: 0 };
}

/** Two digits for the countdown tiles. */
export function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}

// ---------------------------------------------------------------- prices

/** "QAR 320" from a decimal string or number; a broken price shows nothing. */
export function formatPrice(price: string | number | null | undefined, currency: string, locale: string): string {
  const n = typeof price === "number" ? price : Number(String(price ?? "").trim());
  if (!Number.isFinite(n)) return "";
  const code = /^[A-Z]{3}$/.test(currency || "") ? currency : "QAR";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code, currencyDisplay: "code", minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n).replace(/\u00a0/g, " ");
  } catch {
    return `${code} ${n}`;
  }
}

/** The listing figures a product may carry (beds, baths, size), as text, when it has them. */
export function listingFacts(meta: Record<string, unknown> | null | undefined): { beds: string; baths: string; size: string } {
  const read = (k: string) => {
    const v = meta?.[k];
    return typeof v === "number" || (typeof v === "string" && v.trim()) ? String(v).trim() : "";
  };
  return { beds: read("beds"), baths: read("baths"), size: read("size") };
}

/** The menu group of a product (`meta.category`), or "" when it has none. */
export function categoryOf(meta: Record<string, unknown> | null | undefined): string {
  const v = meta?.category;
  return typeof v === "string" ? v.trim() : "";
}

/** Products grouped by their menu category, in first-seen order; products without one come first under "". */
export function groupByCategory(products: readonly PublicProduct[]): { category: string; items: PublicProduct[] }[] {
  const groups = new Map<string, PublicProduct[]>();
  for (const p of products) {
    const c = categoryOf(p.meta);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(p);
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }));
}

// ---------------------------------------------------------------- calendar file

function icsDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[;,]/g, (m) => `\\${m}`);
}

/** A calendar file for the event, ready for a `data:` link; null when the start is not a date. */
export function icsFor(ev: Pick<EventSectionData, "event_name" | "starts_at" | "ends_at" | "venue" | "hall" | "stand" | "talk_title">, url: string): string | null {
  const start = icsDate(ev.starts_at);
  if (!start) return null;
  const end = (ev.ends_at && icsDate(ev.ends_at)) || icsDate(new Date(Date.parse(ev.starts_at) + 3600_000).toISOString())!;
  const where = [ev.venue, ev.hall, ev.stand].filter(Boolean).join(", ");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BENCH//card//EN", "BEGIN:VEVENT",
    `UID:${start}-${Math.abs(hash(ev.event_name + url))}@bench`,
    `DTSTAMP:${start}`, `DTSTART:${start}`, `DTEND:${end}`,
    `SUMMARY:${icsText(ev.talk_title || ev.event_name)}`,
  ];
  if (where) lines.push(`LOCATION:${icsText(where)}`);
  if (ev.talk_title && ev.event_name) lines.push(`DESCRIPTION:${icsText(ev.event_name)}`);
  if (url) lines.push(`URL:${url}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** True for an address a section may link to (https only). */
export function safeHttps(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https:\/\/[^\s]+$/i.test(url.trim());
}

/** The kinds a card may still add: one of each, products up to three. */
export function addableKinds(existing: readonly { kind: SectionKind }[]): SectionKind[] {
  const count = (k: SectionKind) => existing.filter((s) => s.kind === k).length;
  return SECTION_KINDS.filter((k) => (k === "products" ? count(k) < MAX_PRODUCTS_SECTIONS : count(k) === 0));
}

export const MAX_SECTIONS = 8;
export const MAX_PRODUCTS_SECTIONS = 3;
export const MAX_TEAM = 12;
export const MAX_GALLERY = 9;
