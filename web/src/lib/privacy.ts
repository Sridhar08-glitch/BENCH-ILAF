// Small pure helpers for the Privacy and data screen, kept apart so they can be tested.
import type { DataRequest } from "./account-api";
import { runtimeT, type TFunction } from "./i18n";

/** The word a person types to confirm deleting their own account. */
export const DELETE_WORD = "DELETE";

export type ExportState = "none" | "preparing" | "ready" | "used" | "expired" | "failed";

/** What to show for an export request: preparing, ready (with a link), already downloaded, expired or failed. */
export function exportState(req: DataRequest | undefined, now = Date.now()): ExportState {
  if (!req || req.kind !== "export") return "none";
  if (req.status === "pending" || req.status === "processing") return "preparing";
  if (req.status === "failed") return "failed";
  if (req.status === "completed") return "used";
  if (req.status === "expired") return "expired";
  if (req.status === "ready") {
    return req.download_available && (!req.expires_at || Date.parse(req.expires_at) > now) ? "ready" : "expired";
  }
  return "none";
}

/** The newest export for the person's own data (`workspaceId` undefined) or for one company. */
export function latestExport(requests: DataRequest[] | undefined, workspaceId?: string): DataRequest | undefined {
  return (requests ?? [])
    .filter((r) => r.kind === "export" && (workspaceId ? r.workspace_id === workspaceId : r.scope === "user"))
    .sort((a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at))[0];
}

/** Whole days left until a date (rounded up, never below zero). */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return 0;
  const ms = Date.parse(iso) - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** "5 hours" or "40 minutes" until a link expires. */
export function timeLeft(iso: string | null | undefined, t: TFunction, now = Date.now()): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.floor((Date.parse(iso) - now) / 60_000));
  if (minutes >= 90) return t("settings.timeHours", { n: Math.round(minutes / 60) });
  if (minutes >= 60) return t("settings.timeHours", { n: 1 });
  return t("settings.timeMinutes", { n: minutes });
}

/** A date as "22 November 2026" in the user's language (`date` is the formatter from useI18n). */
export function formatDay(iso: string | null | undefined, date: (d: Date | string | number, options?: Intl.DateTimeFormatOptions) => string): string {
  if (!iso) return "";
  return date(iso, { day: "numeric", month: "long", year: "numeric" });
}

/** A file size with Latin unit symbols (B, KB, MB); `number` writes the digits the way the user chose. */
export function formatSize(bytes: number, number: (n: number, options?: Intl.NumberFormatOptions) => string = (n, o) => n.toFixed(o?.minimumFractionDigits ?? 0)): string {
  if (bytes < 1024) return `${number(bytes)} B`;
  if (bytes < 1024 * 1024) return `${number(Math.round(bytes / 1024))} KB`;
  return `${number(bytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

/** True when the typed text matches the required text exactly (spaces around it are ignored). */
export function confirmMatches(typed: string, required: string): boolean {
  return required.length > 0 && typed.trim() === required;
}

/** Plain-words message for the API errors the deletion and export screens can meet. */
export function privacyErrorText(code: string, fallback: string, t: TFunction = runtimeT): string {
  return code === "export_limit" ? t("settings.exportLimit") : fallback;
}

/** Turn "northgate.com, @north.co.uk" or one-per-line text into a clean list of lower-case domains. */
export function parseDomains(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const d = raw.trim().toLowerCase().replace(/^@/, "");
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/** True for something that looks like a domain name such as northgate.com. */
export function looksLikeDomain(d: string): boolean {
  return /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d);
}

/** Route parameters can arrive percent-encoded (a signed token holds colons): turn them back into the real text. */
export function decodeToken(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
