// Pure helpers of the staff frame and the screens beside it: the top-bar search results, the menu counts, the announcement
// audience (chips, incoming company selection) and the feature-switch company chips.
import type { SearchResult } from "./api";

/** One line of the top-bar search pop-over. */
export interface SearchRow {
  kind: "company" | "person" | "card";
  id: string;
  title: string;
  sub: string;
}

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_LIMITS = { company: 4, person: 5, card: 5 } as const;

/** The pop-over lines in the order they are shown: companies, people, cards. Each group is cut to its limit. */
export function searchRows(res: SearchResult | undefined | null): SearchRow[] {
  if (!res) return [];
  const rows: SearchRow[] = [];
  for (const c of res.companies.slice(0, SEARCH_LIMITS.company)) rows.push({ kind: "company", id: c.id, title: c.name, sub: c.owner_email });
  for (const p of res.people.slice(0, SEARCH_LIMITS.person)) {
    rows.push({ kind: "person", id: p.id, title: p.full_name || p.email, sub: [p.full_name ? p.email : "", p.companies[0]?.name ?? ""].filter(Boolean).join(" - ") });
  }
  for (const c of res.cards.slice(0, SEARCH_LIMITS.card)) {
    rows.push({ kind: "card", id: c.id, title: c.name || "(no name)", sub: [c.public_url ? c.public_url.replace(/^https?:\/\//, "") : "", c.workspace_name].filter(Boolean).join(" - ") });
  }
  return rows;
}

/** Where "See all results" leads. */
export function searchAllHref(term: string): string {
  return `/staff/people?q=${encodeURIComponent(term.trim())}`;
}

/** The staff page of a company row. */
export function companyHref(id: string): string {
  return `/staff/companies/${id}`;
}

/** Move the highlighted line with the arrow keys; wraps round, -1 means none. */
export function moveActive(current: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return current < 0 || current >= count - 1 ? 0 : current + 1;
  return current <= 0 ? count - 1 : current - 1;
}

/** Whether a key press should put the cursor in the search box: "/" when the person is not typing somewhere. */
export function isSearchShortcut(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: EventTarget | null }): boolean {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return false;
  const el = e.target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  const tag = el?.tagName?.toLowerCase();
  return !(tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable);
}

/** The menu items that carry a count, and the field of the counts answer each one reads. */
export const COUNT_FIELDS: Record<string, "open_reports" | "open_data_requests"> = {
  "/staff/abuse": "open_reports",
  "/staff/data-requests": "open_data_requests",
};

export interface StaffCounts { open_reports: number; open_data_requests: number }

export const COUNTS_KEY = ["staff-menu-counts"] as const;

export function countFor(href: string, counts: StaffCounts | undefined | null): number | undefined {
  const field = COUNT_FIELDS[href];
  return field && counts ? counts[field] : undefined;
}

// ---------------------------------------------------------------- announcements: audience picker
export const COMPANIES_QUERY_KEY = "companies";
export const COMPANIES_STORAGE_KEY = "staff-announce-companies";

/** Split a list of ids written as "a,b" (or a JSON array) into clean unique ids. */
export function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let items: unknown[] = [];
  const text = raw.trim();
  if (text.startsWith("[")) {
    try { const parsed: unknown = JSON.parse(text); if (Array.isArray(parsed)) items = parsed; } catch { /* fall through to a plain list */ }
  }
  if (items.length === 0) items = text.split(",");
  const seen = new Set<string>();
  for (const item of items) {
    const id = String(item ?? "").trim();
    if (/^[0-9a-fA-F-]{8,64}$/.test(id)) seen.add(id.toLowerCase());
  }
  return [...seen];
}

/** The company ids a screen was opened with: the URL query wins, the browser storage is the fallback. */
export function incomingCompanyIds(search: string, stored: string | null | undefined): string[] {
  const fromUrl = parseIdList(new URLSearchParams(search).get(COMPANIES_QUERY_KEY));
  return fromUrl.length > 0 ? fromUrl : parseIdList(stored);
}

/** Add a value to a picked list, or take it out when it is there already. */
export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** The text a country code stands for in the picker ("QA" reads "Qatar (QA)"); the code alone when the name is unknown. */
export function countryName(code: string, locale = "en"): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "region" }).of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? `${name} (${code.toUpperCase()})` : code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** The picker needs at least one value for any audience except "all". */
export function audienceReady(kind: string, values: readonly string[]): boolean {
  return kind === "all" || values.length > 0;
}

/** The word the person must type before an announcement goes out. */
export const SEND_WORD = "SEND";

export interface AudienceCount { companies: number; people: number; label: string }

/** One sentence for the live count under the audience picker. */
export function audienceSentence(count: AudienceCount, via: { banner: boolean; email: boolean }): string {
  const companies = `${count.companies} ${count.companies === 1 ? "company" : "companies"}`;
  const parts: string[] = [];
  if (via.banner) parts.push(`${companies} will see the banner`);
  if (via.email) parts.push(`${count.people} ${count.people === 1 ? "person" : "people"} will get the e-mail`);
  return parts.length ? `${parts.join(", ")}.` : `${companies} in this audience.`;
}
