// "Turn this into a team": when to suggest a company to someone on a personal workspace, and how long a "Not now" lasts.
// Everything here is pure (the clock and the storage are passed in) so the rules can be tested.
import type { Plan } from "@/lib/types";

export const SNOOZE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const SNOOZE_KEY = "bench.teamPromptSnoozeUntil";

/** Mail providers where an address says nothing about a person's company. Matched on the name before the ending (hotmail.co.uk counts as hotmail). */
const PUBLIC_BRANDS = new Set([
  "gmail", "googlemail", "outlook", "hotmail", "live", "msn", "windowslive", "yahoo", "ymail", "rocketmail", "icloud", "me", "mac",
  "proton", "protonmail", "pm", "tutanota", "tuta", "fastmail", "hey", "zoho", "aol", "gmx", "web", "mail", "inbox", "bk", "list", "yandex",
  "rambler", "qq", "163", "126", "sina", "naver", "daum", "hanmail", "rediffmail", "t-online", "freenet", "orange", "wanadoo", "free", "laposte",
  "libero", "virgilio", "tiscali", "seznam", "wp", "o2", "interia", "onet", "maktoob", "mailinator", "duck", "skiff",
]);
/** Second-level names that sit before a country ending (co.uk, com.sa). */
const GENERIC_SECOND = new Set(["co", "com", "net", "org", "gov", "ac", "edu", "ne", "or"]);

/** The part of an address after the @, lower case. Empty when there is none. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/** True for a common public mail provider (gmail, outlook, hotmail, yahoo, icloud, proton and local ones) or an address with no domain. */
export function isPublicEmailDomain(email: string): boolean {
  const domain = emailDomain(email);
  if (!domain || !domain.includes(".")) return true;
  const labels = domain.split(".");
  const n = labels.length;
  const name = n >= 3 && GENERIC_SECOND.has(labels[n - 2]) ? labels[n - 3] : labels[n - 2];
  return PUBLIC_BRANDS.has(name);
}

export interface PromptCard {
  status: string;
  company: string;
  /** Whether the card shows a company logo (personal cards have none today). */
  hasLogo?: boolean;
  /** The number of contacts the card received; null when unknown. */
  leads: number | null;
}

export interface PromptInput {
  /** The workspace the person is in. */
  workspaceKind: "personal" | "company";
  /** The person belongs to at least one company already. */
  hasCompany: boolean;
  email: string;
  cards: PromptCard[];
  /** Milliseconds since the epoch when a "Not now" ends; null when never dismissed. */
  snoozedUntil: number | null;
  now: number;
}

/** The cards that make a team worth suggesting: published, and showing a company or already collecting contacts. */
export function promptCards(cards: PromptCard[]): PromptCard[] {
  return cards.filter((c) => c.status === "published" && (c.company.trim() !== "" || c.hasLogo === true || (c.leads ?? 0) >= 1));
}

/** The company name to put in the new-company form: the first matching card's company, else empty. */
export function suggestedCompanyName(cards: PromptCard[]): string {
  return promptCards(cards).find((c) => c.company.trim() !== "")?.company.trim() ?? "";
}

export function shouldShowTeamPrompt(i: PromptInput): boolean {
  if (i.workspaceKind !== "personal" || i.hasCompany) return false;
  if (isPublicEmailDomain(i.email)) return false;
  if (i.snoozedUntil !== null && i.snoozedUntil > i.now) return false;
  return promptCards(i.cards).length > 0;
}

export function snoozeEnd(now: number): number {
  return now + SNOOZE_DAYS * DAY_MS;
}

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The end of the last "Not now" snooze; null when there is none or storage is unavailable. */
export function readSnooze(storage: Reader | null = safeStorage()): number | null {
  try {
    const v = Number(storage?.getItem(SNOOZE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeSnooze(now: number, storage: Writer | null = safeStorage()): void {
  try {
    storage?.setItem(SNOOZE_KEY, String(snoozeEnd(now)));
  } catch {
    /* storage unavailable: the card comes back on the next visit, which is harmless */
  }
}

/** The smallest number of seats a company plan can be bought with, from the plans the API returns. Null when there is none to quote. */
export function minCompanySeats(plans: Plan[] | undefined): number | null {
  const seats = (plans ?? []).filter((p) => p.kind === "company" && p.per_seat && !p.by_quote && p.purchasable !== false && p.min_seats > 0).map((p) => p.min_seats);
  return seats.length ? Math.min(...seats) : null;
}
