// Pure logic for the contacts screen: status names, filters, the timeline sentences.
import type { MessageKey, TFunction } from "../i18n";
import { tk } from "../i18n";
import type { LeadStatus } from "../types";
import { isolate, isolateLtr } from "./bidi";
import type { LeadActivity, LeadQuery } from "./types";

export const STATUSES: { k: LeadStatus; t: MessageKey; c: string }[] = [
  { k: "new", t: tk("contacts.statusNew"), c: "accent" },
  { k: "contacted", t: tk("contacts.statusContacted"), c: "" },
  { k: "qualified", t: tk("contacts.statusQualified"), c: "ok" },
  { k: "won", t: tk("contacts.statusWon"), c: "ok" },
  { k: "lost", t: tk("contacts.statusLost"), c: "bad" },
];

export const SOURCES: { k: string; t: MessageKey }[] = [
  { k: "exchange", t: tk("contacts.sourceExchange") },
  { k: "meeting_request", t: tk("contacts.sourceMeeting") },
  { k: "scanned_card", t: tk("contacts.sourceScanned") },
  { k: "event", t: tk("contacts.sourceEvent") },
];

export function statusName(k: string, t: TFunction): string {
  const s = STATUSES.find((x) => x.k === k);
  return s ? t(s.t) : k;
}

export type Tab = "all" | "mine" | "unassigned";

export interface LeadFilters {
  q: string;
  status: string;
  source: string;
  assignee: string;
  card: string;
  from: string;
  to: string;
}

export const NO_FILTERS: LeadFilters = { q: "", status: "", source: "", assignee: "", card: "", from: "", to: "" };

/** How many filters (not counting the search box and the tab) are set. */
export function filterCount(f: LeadFilters): number {
  return (Object.keys(f) as (keyof LeadFilters)[]).filter((k) => k !== "q" && f[k] !== "").length;
}

/** The query for the list. The tab wins over the assignee filter. */
export function leadQuery(f: LeadFilters, tab: Tab, page: number, size: number): LeadQuery {
  const assignee = tab === "mine" ? "me" : tab === "unassigned" ? "none" : f.assignee || undefined;
  return {
    q: f.q.trim() || undefined, status: f.status || undefined, source: f.source || undefined, assignee,
    card_id: f.card || undefined, from: f.from || undefined, to: f.to || undefined, limit: size, offset: page * size,
  };
}

/** `from` must not be after `to`. Returns the message, or null. */
export function rangeProblem(f: Pick<LeadFilters, "from" | "to">, t: TFunction): string | null {
  return f.from && f.to && f.from > f.to ? t("contacts.rangeProblem") : null;
}

/** One plain sentence for a line of the timeline. */
export function describeActivity(a: LeadActivity, t: TFunction): string {
  const who = isolate(a.actor ?? t("contacts.someone"));
  const d = a.details as Record<string, string | number | null | undefined>;
  const name = (v: string | number | null | undefined) => isolate(String(v ?? ""));
  switch (a.kind) {
    case "created":
      return t("contacts.actCreated");
    case "assigned":
      if (!d.to) return t("contacts.actTookOff", { who, previous: d.previous ? name(d.previous) : t("contacts.itsOwner") });
      return d.previous
        ? t("contacts.actMoved", { who, previous: name(d.previous), to: name(d.to) })
        : t("contacts.actAssigned", { who, to: name(d.to) });
    case "status_changed":
      return t("contacts.actStatus", { who, from: statusName(String(d.old), t), to: statusName(String(d.new), t) });
    case "note_added":
      return t("contacts.actNote", { who });
    case "emailed":
      if (d.reason === "assigned") return t("contacts.actEmailedTo", { to: isolateLtr(String(d.to ?? "")) });
      return d.recipients ? t("contacts.actHolderN", { n: Number(d.recipients) }) : t("contacts.actHolder");
    default:
      return a.kind;
  }
}

/** The sentence after a bulk run, for the toast. */
export function bulkSummary(r: { ok: number; failed: number }, t: TFunction): string {
  if (r.failed === 0) return t("contacts.bulkAllOk", { n: r.ok });
  return t("contacts.bulkSome", { ok: r.ok, failed: r.failed });
}
