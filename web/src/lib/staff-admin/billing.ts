// Pure helpers of the staff Billing screens, the plan facts on the companies list and the conversion funnel.
// Money arrives in minor units (QAR); it is formatted with the same helper as the Enterprise requests (fmtMoney).
import { fmtDay } from "./format";
import { fmtMoney } from "./enterprise";

export const CURRENCY = "QAR";

/** QAR from minor units: "1,234.56 QAR". */
export function qar(minor: number | null | undefined): string {
  return fmtMoney(minor, CURRENCY);
}

/** Whole QAR without decimals for big tiles: "27,300 QAR". */
export function qarShort(minor: number | null | undefined): string {
  if (minor == null) return "-";
  return `${Math.round(minor / 100).toLocaleString("en-US")} ${CURRENCY}`;
}

export type RenewalMode = "auto" | "manual" | "cancels" | "none";

/** What the renewal of a plan is: Stripe charges again (on), nothing is scheduled (off), switched off and runs to its end, or not a paid plan. */
export function renewalWord(mode: RenewalMode | string | undefined | null): string {
  switch (mode) {
    case "auto": return "Auto-renew on";
    case "manual": return "Auto-renew off";
    case "cancels": return "Cancels at period end";
    default: return "-";
  }
}

export function renewalTone(mode: RenewalMode | string | undefined | null): "ok" | "warn" | "" {
  return mode === "auto" ? "ok" : mode === "manual" || mode === "cancels" ? "warn" : "";
}

export const DOMAIN_WORDS: Record<string, string> = {
  pending: "Waiting for DNS", verified: "Verified", failed: "Check failed", expired: "Claim expired", dns_broken: "DNS records missing",
};

export function domainTone(status: string | null | undefined): "ok" | "warn" | "bad" | "" {
  if (status === "verified") return "ok";
  if (status === "pending" || status === "failed") return "warn";
  if (status === "dns_broken" || status === "expired") return "bad";
  return "";
}

/** The state of a free week for the people screens. */
export function freeWeekWords(personal: { state: string; ends_at: string | null }): { text: string; tone: "ok" | "warn" | "bad" | "" } {
  switch (personal.state) {
    case "free_week": return { text: `Free week, ends ${fmtDay(personal.ends_at)}`, tone: "warn" };
    case "free_week_ended": return { text: "Free week ended", tone: "bad" };
    case "paid": return { text: "Paid plan", tone: "ok" };
    case "paid_ended": return { text: "Paid plan ended", tone: "bad" };
    default: return { text: "No card published yet", tone: "" };
  }
}

/** The link to a Stripe object in the Stripe dashboard. Nothing (null) without an id, so the page renders no link. */
export function stripeLink(kind: "customer" | "subscription" | "invoice", id: string | null | undefined): string | null {
  const clean = (id ?? "").trim();
  if (!/^[A-Za-z0-9_]+$/.test(clean)) return null;
  const path = { customer: "customers", subscription: "subscriptions", invoice: "invoices" }[kind];
  return `https://dashboard.stripe.com/${path}/${clean}`;
}

/** The sentence of the contact-sharing block. Counts only. */
export function sharingSentence(s: { employees: number; sharing: number }): string {
  if (s.employees === 0) return "No employees yet.";
  return `${s.sharing} of ${s.employees} employee${s.employees === 1 ? "" : "s"} share their new contacts with the company`;
}

export interface FunnelCounts { days: number; signed_up: number; created_card: number; published: number; still_live: number; ended_unpaid: number; converted: number }

/** The rows of the conversion funnel with each step as a share of the sign-ups (whole percent; 0 when nobody signed up). */
export function funnelRows(f: FunnelCounts): { key: string; label: string; value: number; percent: number }[] {
  const steps: [string, string, number][] = [
    ["signed_up", "Signed up", f.signed_up], ["created_card", "Created a card", f.created_card], ["published", "Published (free week started)", f.published],
    ["still_live", "Still live now", f.still_live], ["ended_unpaid", "Free week ended unpaid", f.ended_unpaid], ["converted", "Converted to paid", f.converted],
  ];
  return steps.map(([key, label, value]) => ({ key, label, value, percent: f.signed_up > 0 ? Math.round((100 * value) / f.signed_up) : 0 }));
}

/** Revenue per month as chart bars in whole QAR (the label is the year and month, "26-11"). */
export function revenuePoints(rows: { month: string; amount_minor: number }[]): { label: string; value: number }[] {
  return rows.map((r) => ({ label: r.month.slice(2), value: Math.round(r.amount_minor / 100) }));
}

/** Plain days word for a renewal row: "in 3 days", "today", "1 day late (grace days)". */
export function daysWord(days: number): string {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} late (grace days)`;
  if (days === 0) return "today";
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/** The query of a table: only the filters that have a value. */
export function cleanQuery(q: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v)) as Record<string, string>;
}
