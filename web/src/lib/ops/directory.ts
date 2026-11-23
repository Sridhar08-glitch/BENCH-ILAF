// Pure logic for the company directory: the address rules (same as the API) and page links.
import { APP_NAME } from "../config";
import type { TFunction } from "../i18n";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
// Words the address may not be, the API refuses them too.
const RESERVED = new Set([
  "app", "api", "admin", "c", "join", "login", "logout", "register", "signup", "pricing", "about", "help", "support", "terms",
  "privacy", "static", "media", "public", "www", "brand", "assets", "settings", "billing", "cards", "team", "leads", "analytics",
  "new", "ilaf", "ilafone", "bench", "directory", "d", "search", "all", "company", "companies", "people",
]);

export function normaliseDirectorySlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/** Plain-words problem with an address, or null when it can be tried (the API still checks it is free). */
export function directorySlugProblem(raw: string, t: TFunction): string | null {
  const s = normaliseDirectorySlug(raw);
  if (!s) return t("company.slugChoose");
  if (!SLUG_RE.test(s)) return t("company.slugFormat");
  if (RESERVED.has(s)) return t("company.slugReserved");
  return null;
}

/** The path of the public page. */
export const directoryPath = (slug: string) => `/d/${slug}`;

/** The full address visitors use. */
export const directoryUrl = (base: string, slug: string) => `${base.replace(/\/+$/, "")}${directoryPath(slug)}`;

export interface DirectoryParams {
  q?: string;
  department?: string;
  page?: number;
}

/** Query string for the directory page (empty values and page 1 are left out). */
export function directoryQuery(p: DirectoryParams): string {
  const sp = new URLSearchParams();
  if (p.q?.trim()) sp.set("q", p.q.trim());
  if (p.department) sp.set("department", p.department);
  if (p.page && p.page > 1) sp.set("page", String(p.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Read a positive whole page number from the address, defaulting to 1. */
export function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

/** Page title and description for search engines. */
export function directoryMeta(company: string, total: number, t: TFunction): { title: string; description: string } {
  return {
    title: t("company.pubMetaTitle", { company }),
    description: t("company.pubMetaDescription", { n: total, company, app: APP_NAME }),
  };
}

/** "12 people" or "3 people match your search", the line under the search box. */
export function resultsLine(count: number, total: number, hasFilter: boolean, t: TFunction): string {
  return hasFilter ? t("company.pubResultsFiltered", { n: count }) : t("company.pubResults", { n: total });
}
