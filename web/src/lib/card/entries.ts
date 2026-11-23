// The card's buttons prepared for the area below the card: real links, labels, groups and logos.
import type { ResolvedIcon } from "./brand";
import { itemLabel, platformOf, visibleItems } from "./catalogue";
import { hrefFor, mapsSearchUrl } from "./href";
import { isMeetingForm } from "./meeting";
import type { TFunction } from "@/lib/i18n";

/** c = contact (phone, mail, directions), s = social profile, w = website and other links. */
export type EntryGroup = "c" | "s" | "w";

export interface Entry {
  kind: string;
  label: string;
  /** Short text shown under or next to the label. */
  value: string;
  /** Safe link, or null when the value cannot be opened (the button is then disabled). */
  href: string | null;
  group: EntryGroup;
  res?: ResolvedIcon;
}

const WEB_LIKE = new Set([
  "Website", "Calendly", "Meeting", "AppStore", "GooglePlay", "PayPal", "Custom",
  "Document", "DownloadFile", "Menu", "GoogleReview", "Trustpilot", "TripAdvisor", "Vimeo", "Loom", "AppleMaps", "WhatsAppChannel",
  "Airbnb", "Etsy", "Shopify", "Amazon",
]);

export function groupOf(kind: string): EntryGroup {
  if (platformOf(kind).group === "contact") return "c";
  return WEB_LIKE.has(kind) ? "w" : "s";
}

/**
 * Entries for the details area. Only switched-on buttons with a value appear. When the card has an
 * address but no Location button, the address is added as a directions entry that opens maps.
 */
export function buildEntries(
  items: { kind: string; value: string; label?: string; on?: boolean; res?: ResolvedIcon }[],
  address: string,
  t?: TFunction,
): Entry[] {
  const out: Entry[] = visibleItems(items).map((it) => ({
    kind: it.kind,
    label: itemLabel(it, t),
    value: it.kind === "Meeting" && isMeetingForm(it.value) ? (t ? t("card.sendRequest") : "Send a request") : it.value.trim(),
    href: hrefFor(it.kind, it.value),
    group: groupOf(it.kind),
    res: it.res,
  }));
  const addr = address.trim();
  if (addr && !out.some((e) => e.kind === "Location")) {
    out.push({ kind: "Location", label: t ? t("card.btnLocation") : "Directions", value: addr, href: mapsSearchUrl(addr), group: "c" });
  }
  return out;
}

/** The first entry of any of these kinds. */
export function firstOf(entries: Entry[], ...kinds: string[]): Entry | undefined {
  for (const k of kinds) {
    const e = entries.find((x) => x.kind === k);
    if (e) return e;
  }
  return undefined;
}

/** The four round quick-action buttons: the first contact entries. */
export function quickEntries(entries: Entry[]): Entry[] {
  return entries.filter((e) => e.group === "c").slice(0, 4);
}

/** Split a full name into first and last parts for the faces that stack them. */
export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}
