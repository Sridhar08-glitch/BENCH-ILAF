// Pure logic for the analytics tabs: sorting, change against the previous period, date ranges, CSV.
import { tk, type I18n, type MessageKey, type TFunction } from "../i18n";
import type { Metrics } from "./types";

export const COLUMNS: { k: keyof Metrics; t: MessageKey }[] = [
  { k: "views", t: tk("analytics.colViews") },
  { k: "scans", t: tk("analytics.colScans") },
  { k: "saves", t: tk("analytics.colSaves") },
  { k: "link_clicks", t: tk("analytics.colClicks") },
  { k: "leads", t: tk("analytics.colLeads") },
  { k: "won", t: tk("analytics.colWon") },
];

/** Percentage change from the earlier period, or null when there is nothing to compare with. */
export function changePct(now: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((now - prev) / prev) * 100);
}

/** "+50%", "new" or "no change", written in the language and digits of the reader. */
export function changeText(now: number, prev: number, i18n: Pick<I18n, "t" | "number">): string {
  if (prev === 0) return now === 0 ? i18n.t("analytics.changeNone") : i18n.t("analytics.changeNew");
  const p = changePct(now, prev) as number;
  return i18n.number(p / 100, { style: "percent", signDisplay: "always" });
}

/** A share of a hundred, such as 2.5 for "2.5%", in the language and digits of the reader. */
export function percentText(value: number, number: I18n["number"]): string {
  return number(value / 100, { style: "percent", maximumFractionDigits: 1 });
}

export type SortKey = keyof Metrics | "name" | "conversion";
export type Dir = "asc" | "desc";

export interface Sortable {
  name: string;
  totals: Metrics;
}

/** Leads per hundred views, the simplest measure of how well a card turns visits into contacts. */
export function conversion(t: Metrics): number {
  return t.views === 0 ? 0 : Math.round((t.leads / t.views) * 1000) / 10;
}

export function sortRows<T extends Sortable>(rows: T[], key: SortKey, dir: Dir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const val = (r: T): number | string => (key === "name" ? r.name.toLowerCase() : key === "conversion" ? conversion(r.totals) : r.totals[key]);
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x < y) return -sign;
    if (x > y) return sign;
    return a.name.localeCompare(b.name);
  });
}

/** The ranges the picker offers; `days` is missing for the custom range. */
export const RANGES: { k: string; days?: number }[] = [
  { k: "7", days: 7 },
  { k: "30", days: 30 },
  { k: "90", days: 90 },
  { k: "custom" },
];

/** The most days one request may cover (the API refuses more). */
export const MAX_RANGE_DAYS = 365;

export function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

export function customProblem(from: string, to: string, t: TFunction): string | null {
  if (!from || !to) return t("analytics.pickBoth");
  if (from > to) return t("analytics.startAfterEnd");
  if (dayCount(from, to) > MAX_RANGE_DAYS) return t("analytics.tooLong", { days: MAX_RANGE_DAYS });
  return null;
}

/** Week and month buckets get longer labels than days. `date` is the reader's date formatter. */
export function bucketLabel(date: string, group: "day" | "week" | "month", fmt: I18n["date"]): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (group === "month") return fmt(d, { month: "short", year: "2-digit", timeZone: "UTC" });
  return fmt(d, { day: "numeric", month: "short", timeZone: "UTC" });
}

/** The group that keeps a chart readable: days up to 45, weeks up to 200, then months. */
export function defaultGroup(days: number): "day" | "week" | "month" {
  return days <= 45 ? "day" : days <= 200 ? "week" : "month";
}

export function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** A cell that starts with = + - @ would run as a formula in a spreadsheet. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A spreadsheet file (UTF-8 with a byte-order mark so Excel reads accents). */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function downloadCsv(name: string, text: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** A round number just above the largest value, for chart axes. */
export function niceMax(n: number): number {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  const f = n / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}
