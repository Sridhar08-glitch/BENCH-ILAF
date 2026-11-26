// Enterprise-only features: what the company may use and how the screens talk about it. The server enforces it (403 plan_limit);
// this only hides and locks screens so nobody lands on a page that cannot work.
import type { EnterpriseFeature, Subscription } from "@/lib/types";

/** Whether the plan has the feature. A subscription without the list (an older answer) is treated as having it, the server still decides. */
export function hasFeature(sub: Subscription | null | undefined, feature: EnterpriseFeature): boolean {
  const flag = sub?.features?.[feature];
  return flag === undefined ? true : flag;
}

/** Where a locked screen sends the owner: the quote form on the billing page. */
export const ENTERPRISE_FORM_HREF = "/app/billing#enterprise";

/** The price of a quote: total per year and per seat, from the minor units the server sent. */
export function quoteTotal(seats: number, perSeatMinor: number): number {
  return seats * perSeatMinor;
}
