// Small pure helpers of the overview, system health, abuse and analytics screens.

/** "+3 in 4 weeks" style hint: a signed change with a short period name. */
export function changeText(change: number, period: string): string {
  const sign = change > 0 ? "+" : change < 0 ? "-" : "";
  return `${sign}${Math.abs(change).toLocaleString("en-US")} ${period}`;
}

/** Compare this period with the one before: "+6.2% vs last week", "no change", or a plain note when the earlier period was empty. */
export function versusText(now: number, before: number, period: string): string {
  if (before === 0) return now === 0 ? `no change vs ${period}` : `${now.toLocaleString("en-US")} vs none ${period}`;
  const pct = Math.round(((now - before) / before) * 1000) / 10;
  if (pct === 0) return `no change vs ${period}`;
  return `${pct > 0 ? "+" : "-"}${Math.abs(pct)}% vs ${period}`;
}

/** A percentage with its sign-free value, or a dash when it cannot be known yet (no traffic). */
export function fmtPercent(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${Number(value.toFixed(digits))}%`;
}

/** Tone of an error rate: more than 1% of requests failing is bad, any failure is a warning. */
export function errorRateTone(rate: number | null): "ok" | "warn" | "bad" {
  if (rate == null || rate === 0) return "ok";
  return rate > 1 ? "bad" : "warn";
}

/** Share of each storage category of the total, in whole percent, for the bar widths. */
export function storageShares(categories: { key: string; label: string; bytes: number }[]): { key: string; label: string; bytes: number; share: number }[] {
  const total = categories.reduce((n, c) => n + c.bytes, 0);
  return categories.map((c) => ({ ...c, share: total ? Math.round((100 * c.bytes) / total) : 0 }));
}

/** "2026-08" as "Aug 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** The result line after a bulk action: how many worked and which reasons the others failed with. */
export function bulkSummary(results: { ok: boolean; error?: string }[], done = "done"): string {
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  if (!failed) return `${ok} of ${results.length} ${done}`;
  const reasons = [...new Set(results.filter((r) => !r.ok).map((r) => r.error ?? "not found"))].join(", ");
  return `${ok} of ${results.length} ${done}; ${failed} skipped (${reasons})`;
}

/** The report number to show: the short number when there is one, else the first 8 characters of the id. */
export function reportNumber(r: { short_id: string; id: string }): string {
  return r.short_id || r.id.slice(0, 8);
}
