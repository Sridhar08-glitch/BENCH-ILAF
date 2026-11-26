// Booking helpers: what the visitor's calendar needs (dates in the card's time zone, the slot list) and the checks the
// owner's opening-hours editor runs before it saves. The API repeats every check.

export const SLOT_CHOICES = [15, 30, 45, 60] as const;
export const DAYS_AHEAD_MIN = 7;
export const DAYS_AHEAD_MAX = 90;
export const BUFFER_MAX = 60;
/** The availability call answers for at most this many days at a time. */
export const AVAILABILITY_DAYS = 14;

export interface Window {
  d: number;
  from: string;
  to: string;
}

export interface BookingSettings {
  enabled: boolean;
  timezone: string;
  slot_minutes: number;
  buffer_minutes: number;
  days_ahead: number;
  weekly: Window[];
  location_note: string;
  meet_link: string;
}

export const DEFAULT_SETTINGS: BookingSettings = {
  enabled: false,
  timezone: "Asia/Qatar",
  slot_minutes: 30,
  buffer_minutes: 0,
  days_ahead: 30,
  weekly: [0, 1, 2, 3, 4].map((d) => ({ d, from: "09:00", to: "17:00" })),
  location_note: "",
  meet_link: "",
};

export function minutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

export type WeeklyProblem = { kind: "time" | "order" | "overlap"; d: number } | null;

/** The first mistake in the weekly windows: an unreadable time, a window that ends before it starts, or two that overlap. */
export function weeklyProblem(weekly: readonly Window[]): WeeklyProblem {
  for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    const spans: [number, number][] = [];
    for (const w of weekly.filter((x) => x.d === d)) {
      const a = minutes(w.from);
      const b = minutes(w.to);
      if (a === null || b === null) return { kind: "time", d };
      if (b <= a) return { kind: "order", d };
      spans.push([a, b]);
    }
    spans.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1]) return { kind: "overlap", d };
  }
  return null;
}

/** The windows of one day, earliest first. */
export function windowsOf(weekly: readonly Window[], d: number): Window[] {
  return weekly.filter((w) => w.d === d).sort((a, b) => (minutes(a.from) ?? 0) - (minutes(b.from) ?? 0));
}

/** One more window on a day, starting where the day's last one ends (or at nine). */
export function withWindow(weekly: readonly Window[], d: number): Window[] {
  const last = windowsOf(weekly, d).pop();
  const start = last ? (minutes(last.to) ?? 17 * 60) : 9 * 60;
  const from = Math.min(start, 23 * 60);
  const to = Math.min(from + 120, 24 * 60 - 1);
  const hh = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  return [...weekly, { d, from: hh(from), to: hh(to) }];
}

export function withoutWindow(weekly: readonly Window[], d: number, index: number): Window[] {
  const day = windowsOf(weekly, d);
  const gone = day[index];
  if (!gone) return weekly.slice();
  let skipped = false;
  return weekly.filter((w) => {
    if (!skipped && w.d === gone.d && w.from === gone.from && w.to === gone.to) {
      skipped = true;
      return false;
    }
    return true;
  });
}

export function replaceWindow(weekly: readonly Window[], d: number, index: number, patch: Partial<Window>): Window[] {
  const day = windowsOf(weekly, d);
  const target = day[index];
  if (!target) return weekly.slice();
  let done = false;
  return weekly.map((w) => {
    if (!done && w.d === target.d && w.from === target.from && w.to === target.to) {
      done = true;
      return { ...w, ...patch };
    }
    return w;
  });
}

/** Today's date (YYYY-MM-DD) in a time zone: the first day the visitor may pick. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** A calendar date shifted by whole days (no time zone involved). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const base = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  base.setUTCDate(base.getUTCDate() + n);
  return base.toISOString().slice(0, 10);
}

export interface AvailabilityDay {
  date: string;
  slots: string[];
}

/** The days that have at least one free slot. */
export function openDays(days: readonly AvailabilityDay[]): AvailabilityDay[] {
  return days.filter((d) => d.slots.length > 0);
}

/** A date as the visitor's language writes it ("Mon, 5 Jan"); the date is a calendar day, so it is read as UTC noon. */
export function dayLabel(date: string, locale: string, style: "short" | "long" = "short"): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: style === "long" ? "long" : "short", day: "numeric", month: "short" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  } catch {
    return date;
  }
}

/** A slot's clock time ("14:30") in the visitor's habit ("2:30 PM" where that is the custom). */
export function slotLabel(time: string, locale: string): string {
  const mm = minutes(time);
  if (mm === null) return time;
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(new Date(Date.UTC(2000, 0, 1, Math.floor(mm / 60), mm % 60)));
  } catch {
    return time;
  }
}
