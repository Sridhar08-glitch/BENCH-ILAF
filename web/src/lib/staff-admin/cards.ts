// Pure helpers of the card list in the staff area: the query for the endpoint, the status chips with their counts, the "1-25 of 312" range.
import type { CardStatusCounts } from "./api";

export const CARD_PAGE_SIZE = 20;

export interface CardFilters { q: string; status: string; page: number }

export const NO_CARD_FILTERS: CardFilters = { q: "", status: "", page: 1 };

/** The query string values the list endpoint takes; empty filters are left out. */
export function cardsQuery(f: CardFilters, size = CARD_PAGE_SIZE): Record<string, string> {
  const out: Record<string, string> = { limit: String(size), offset: String((Math.max(1, f.page) - 1) * size) };
  if (f.q.trim()) out.q = f.q.trim();
  if (f.status) out.status = f.status;
  return out;
}

export const CARD_CHIPS: readonly { key: string; label: string; count: keyof CardStatusCounts }[] = [
  { key: "", label: "All", count: "all" },
  { key: "active", label: "Active", count: "active" },
  { key: "reported", label: "Reported", count: "reported" },
  { key: "suspended", label: "Suspended", count: "suspended" },
  { key: "draft", label: "Draft", count: "draft" },
];

/** "Reported (3)": a chip label with the number behind it (just the label while the counts are not there yet). */
export function chipText(chip: { label: string; count: keyof CardStatusCounts }, counts: CardStatusCounts | undefined): string {
  return counts ? `${chip.label} (${counts[chip.count]})` : chip.label;
}

/** "1-20 of 312", "0 cards". */
export function cardRange(offset: number, shown: number, count: number): string {
  if (count === 0 || shown === 0) return "0 cards";
  return `${offset + 1}-${offset + shown} of ${count}`;
}

export function cardPages(count: number, size = CARD_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(count / size));
}

/** The word on a card row's status tag: reported cards say so even while they are live. */
export function cardTagWord(status: string, staffHold: boolean, openReports: number): { text: string; tone: "ok" | "warn" | "bad" } {
  if (status === "suspended") return { text: staffHold ? "Suspended" : "Suspended by the company", tone: "bad" };
  if (openReports > 0) return { text: `Reported (${openReports})`, tone: "warn" };
  return status === "published" ? { text: "Active", tone: "ok" } : { text: "Draft", tone: "warn" };
}
