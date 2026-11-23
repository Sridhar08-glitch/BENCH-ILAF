// Pure helpers of the people list in the staff area: query text, the "1-25 of 312" range and the words in the cells.
import type { PersonRow } from "./api";

export const PEOPLE_PAGE_SIZE = 25;

export interface PeopleFilters {
  q: string; plan: string; status: string; role: string; joinedFrom: string; joinedTo: string; hasCompany: string; sort: string; page: number;
}

export const NO_FILTERS: PeopleFilters = { q: "", plan: "", status: "", role: "", joinedFrom: "", joinedTo: "", hasCompany: "", sort: "newest", page: 1 };

/** The query string values the list endpoint takes; empty filters are left out. */
export function peopleQuery(f: PeopleFilters, size = PEOPLE_PAGE_SIZE): Record<string, string> {
  const out: Record<string, string> = { limit: String(size), offset: String((Math.max(1, f.page) - 1) * size), sort: f.sort || "newest" };
  const pairs: [string, string][] = [["q", f.q.trim()], ["plan", f.plan], ["status", f.status], ["role", f.role], ["joined_from", f.joinedFrom], ["joined_to", f.joinedTo], ["has_company", f.hasCompany]];
  for (const [key, value] of pairs) if (value) out[key] = value;
  return out;
}

/** "1-25 of 312", "0 results". */
export function rangeText(offset: number, shown: number, count: number): string {
  if (count === 0 || shown === 0) return "0 results";
  return `${offset + 1}-${offset + shown} of ${count}`;
}

export function pageCount(count: number, size = PEOPLE_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(count / size));
}

export function anyFilter(f: PeopleFilters): boolean {
  return Boolean(f.q.trim() || f.plan || f.status || f.role || f.joinedFrom || f.joinedTo || f.hasCompany);
}

export const STATE_WORDS: Record<string, string> = { live: "Live", expired: "Ended", none: "No plan" };

/** "Personal Plus, live" or "No plan". */
export function planText(cell: { plan: string | null; state: string }): string {
  return cell.plan ? `${cell.plan}, ${(STATE_WORDS[cell.state] ?? cell.state).toLowerCase()}` : "No plan";
}

export const ROLE_WORDS: Record<string, string> = { read_only: "Read only", support: "Support", admin: "Admin" };

/** The badges a row shows next to the name: staff role, disabled, deletion scheduled. */
export function personBadges(p: Pick<PersonRow, "staff_role" | "status">): { text: string; tone: "dark" | "bad" | "warn" }[] {
  const out: { text: string; tone: "dark" | "bad" | "warn" }[] = [];
  if (p.staff_role !== "none") out.push({ text: `Staff: ${ROLE_WORDS[p.staff_role] ?? p.staff_role}`, tone: "dark" });
  if (p.status === "disabled") out.push({ text: "Disabled", tone: "bad" });
  if (p.status === "deletion_pending") out.push({ text: "Deletion scheduled", tone: "warn" });
  return out;
}

/** Companies shown in a cell: the first ones, and how many more there are. */
export function moreCompanies(p: Pick<PersonRow, "company_count" | "companies">): number {
  return Math.max(0, p.company_count - p.companies.length);
}
