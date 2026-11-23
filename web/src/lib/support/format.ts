// Small formatting helpers for the staff screens: durations, SLA timers and their colours.
import type { SlaState } from "./types";

/** "2h 05m", "35m", "3d 4h" for a number of seconds (null gives a dash). */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "-";
  const total = Math.max(0, Math.round(seconds));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}

export type Tone = "ok" | "warn" | "bad" | "plain";
export const SLA_TONE: Record<SlaState, Tone> = { ok: "ok", at_risk: "warn", breached: "bad", paused: "plain", done: "plain" };

/** The time left (or overdue) against a deadline: { text: "1h 20m", late: false }. */
export function timeToDue(due: string | null, now: number): { text: string; late: boolean } | null {
  if (!due) return null;
  const diff = (new Date(due).getTime() - now) / 1000;
  if (!Number.isFinite(diff)) return null;
  return { text: formatDuration(Math.abs(diff)), late: diff < 0 };
}

/** The deadline a ticket is measured against: the first reply until one was sent, then the resolution. */
export function activeDeadline(t: { first_response_at: string | null; first_due_at: string | null; resolve_due_at: string | null }): string | null {
  return t.first_response_at ? t.resolve_due_at : t.first_due_at;
}
