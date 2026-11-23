// Small pure helpers of the staff dashboard: dates, countdowns, sizes and chart numbers.
export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "unknown";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
}

/** "3 h 5 min", "2 days", "overdue by 1 day": a countdown from minutes (negative means late). */
export function fmtMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return "-";
  const late = minutes < 0;
  const m = Math.abs(minutes);
  let text: string;
  if (m < 60) text = `${m} min`;
  else if (m < 48 * 60) text = `${Math.floor(m / 60)} h ${m % 60} min`;
  else text = `${Math.floor(m / 1440)} days`;
  return late ? `late by ${text}` : text;
}

/** Days left of a legal due date: "3 days left", "due today", "2 days overdue". */
export function fmtDays(days: number): string {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "due today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

/** "mm:ss" of a number of seconds (the support view timer). */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${ms} ms`;
}

/** A date and time in UTC, so every member of the team reads the same thing. */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export function fmtDay(iso: string | null | undefined): string {
  return fmtWhen(iso).split(",")[0];
}

export function fmtNumber(n: number | null | undefined): string {
  return n == null ? "-" : n.toLocaleString("en-US");
}

/** Plain words for an audit action key that has no label. */
export function humanAction(key: string): string {
  return key.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
}
