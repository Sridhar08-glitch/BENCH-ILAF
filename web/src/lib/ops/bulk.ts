// Pure logic for selecting many members or cards and running one action on them.
import type { BulkResult, Card, Member } from "../types";
import { apiReasonText } from "../i18n/api-error";
import { runtimeT, tk, type MessageKey, type TFunction } from "../i18n";

/** The most items one bulk request may carry (the API refuses more). */
export const MAX_BULK = 200;

export type MemberAction = "publish" | "unpublish" | "suspend" | "restore" | "role" | "department" | "remove";
export type CardBulkAction = "publish" | "unpublish" | "suspend" | "restore" | "delete";

/** Add or take away one id. Returns a new list in the order ids were picked. */
export function toggleId(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

/** Select every id in `ids` (up to the bulk limit), or clear the selection. */
export function selectAll(ids: string[], on: boolean): string[] {
  return on ? ids.slice(0, MAX_BULK) : [];
}

/** Keep only ids that still exist, e.g. after a refresh or a filter change. */
export function pruneSelection(selected: string[], valid: string[]): string[] {
  const ok = new Set(valid);
  return selected.filter((s) => ok.has(s));
}

/** True when the page's rows are all selected (the header checkbox state). */
export function allSelected(selected: string[], visible: string[]): boolean {
  return visible.length > 0 && visible.every((v) => selected.includes(v));
}

/** The owner's own row cannot be changed by anyone, so it cannot be selected. */
export function memberSelectable(m: Pick<Member, "role">, actorIsOwner: boolean): boolean {
  if (m.role === "owner") return false;
  return m.role !== "admin" || actorIsOwner;
}

export interface ActionChoice<T extends string> {
  id: T;
  /** The message key of the button text. */
  labelKey: MessageKey;
  /** The button text in the current language (read when the screen draws). */
  readonly label: string;
  /** Only the owner sees this action. */
  ownerOnly?: boolean;
  danger?: boolean;
}

function choice<T extends string>(id: T, labelKey: MessageKey, flags: { ownerOnly?: boolean; danger?: boolean } = {}): ActionChoice<T> {
  return { id, labelKey, ...flags, get label() { return runtimeT(labelKey); } };
}

export function memberActions(actorIsOwner: boolean): ActionChoice<MemberAction>[] {
  const all: ActionChoice<MemberAction>[] = [
    choice("publish", tk("company.actPublishCards")),
    choice("unpublish", tk("company.actUnpublishCards")),
    choice("suspend", tk("company.actSuspend")),
    choice("restore", tk("company.actRestore")),
    choice("department", tk("company.actMove")),
    choice("role", tk("company.actRole"), { ownerOnly: true }),
    choice("remove", tk("common.remove"), { danger: true }),
  ];
  return all.filter((a) => !a.ownerOnly || actorIsOwner);
}

export const CARD_ACTIONS: ActionChoice<CardBulkAction>[] = [
  choice("publish", tk("company.actPublish")),
  choice("unpublish", tk("company.actUnpublish")),
  choice("suspend", tk("company.actSuspend")),
  choice("restore", tk("company.actRestore")),
  choice("delete", tk("common.delete"), { danger: true }),
];

/** The confirmation sentence with the counts, in plain words. */
export function confirmText(kind: "members" | "cards", action: string, n: number, extra: { role?: string; department?: string | null } | undefined, t: TFunction): string {
  const who = kind === "members" ? t("company.nPeople", { n }) : t("company.nCards", { n });
  const what = kind === "members" ? t("company.cardsOfPeople", { n }) : t("company.nCards", { n });
  switch (action) {
    case "publish": return t("company.cfPublish", { what, n });
    case "unpublish": return t("company.cfUnpublish", { what, n });
    case "suspend": return kind === "members" ? t("company.cfSuspendMembers", { who }) : t("company.cfSuspendCards", { who });
    case "restore": return kind === "members" ? t("company.cfRestoreMembers", { who }) : t("company.cfRestoreCards", { who });
    case "role": return extra?.role === "admin" ? t("company.cfRoleAdmin", { who }) : t("company.cfRoleEmployee", { who });
    case "department": return extra?.department ? t("company.cfDeptMove", { who, department: extra.department }) : t("company.cfDeptNone", { who });
    case "remove": return t("company.cfRemove", { who });
    case "delete": return t("company.cfDelete", { who });
    default: return t("company.cfDefault", { who });
  }
}

/** One line for a finished run: "4 done, 1 refused". */
export function summarize(r: Pick<BulkResult, "ok" | "failed" | "total">, t: TFunction): string {
  if (r.total === 0) return t("company.sumNothing");
  if (r.failed === 0) return t("company.sumAll", { n: r.ok });
  if (r.ok === 0) return t("company.sumNone", { failed: r.failed });
  return t("company.sumSome", { ok: r.ok, failed: r.failed });
}

/** The refused items with their reasons, for the result list. */
export function failures(r: Pick<BulkResult, "results">) {
  return r.results.filter((x) => !x.ok);
}

/** Group refused items by reason, so 40 identical refusals read as one line with a count. */
export function groupReasons(r: Pick<BulkResult, "results">, t: TFunction): { reason: string; names: string[] }[] {
  const map = new Map<string, string[]>();
  for (const f of failures(r)) {
    const key = apiReasonText(f, t, "company.reasonRefused");
    map.set(key, [...(map.get(key) ?? []), f.name || t("company.nameUnknown")]);
  }
  return [...map.entries()].map(([reason, names]) => ({ reason, names }));
}

/** Cards that can be chosen on the Cards page (managers see every card). */
export function cardSelectable(c: Pick<Card, "id">): boolean {
  return !!c.id;
}
