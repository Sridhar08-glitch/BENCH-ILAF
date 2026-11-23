// The link rules of the buttons that point at one kind of site (a menu, a review page, a store). The server checks the
// same rules; this copy lets the editor say what is wrong before saving. Pure functions.
import type { ItemKind } from "@/lib/types";

/** A site that exists under many country endings (amazon.com, amazon.co.uk, amazon.ae). */
const tld = (name: string) => new RegExp(`(^|\\.)${name}\\.(com|[a-z]{2}|co\\.[a-z]{2}|com\\.[a-z]{2})$`);

type HostRule = string | RegExp;

/** Hosts each kind accepts. null means any https address (a menu or a catalogue can sit on the company's own site). */
export const WEB_KIND_HOSTS: Partial<Record<ItemKind, HostRule[] | null>> = {
  Document: null, // i18n-ok
  Menu: null, // i18n-ok
  Shopify: null, // i18n-ok
  Vimeo: ["vimeo.com"],
  Loom: ["loom.com"],
  GoogleReview: ["g.page", "g.co", "goo.gl", "maps.app.goo.gl", tld("google")],
  Trustpilot: ["trustpilot.com"],
  TripAdvisor: [tld("tripadvisor")],
  AppleMaps: ["maps.apple.com", "maps.apple"],
  WhatsAppChannel: ["whatsapp.com", "chat.whatsapp.com"],
  Airbnb: [tld("airbnb"), "abnb.me"],
  Etsy: ["etsy.com"],
  Amazon: [tld("amazon"), "a.co", "amzn.to", "amzn.eu", "amzn.com"],
};

/** The kind whose value is a PDF the person uploaded (the "Download file" button). */
export const DOWNLOAD_KIND: ItemKind = "DownloadFile";
export const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

export type KindProblem = "https" | "site" | "upload";

function hostMatches(host: string, rules: HostRule[]): boolean {
  return rules.some((r) => (typeof r === "string" ? host === r || host.endsWith(`.${r}`) : r.test(host)));
}

/** The https address a typed value stands for (a bare domain gets https://), or null when it is not one. */
function httpsUrl(value: string): URL | null {
  const v = value.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (scheme && !/^[a-z0-9.-]+:\d+(\/|$)/i.test(v) && scheme[1].toLowerCase() !== "https") return null;
  if (/\s/.test(v)) return null;
  try {
    const url = new URL(scheme ? v : `https://${v.replace(/^\/+/, "")}`);
    if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * What is wrong with a value for a kind that has link rules, or null when it is fine (or the kind has no rules).
 * "https": not a https address. "site": a https address, but not of the site the button is for. "upload": a Download
 * file button whose PDF is not uploaded yet.
 */
export function kindLinkProblem(kind: string, value: string): KindProblem | null {
  const v = value.trim();
  if (!v) return null;
  if (kind === DOWNLOAD_KIND) return /^https?:\/\/\S+\.pdf$/i.test(v.split(/[?#]/)[0]) ? null : "upload";
  const rules = WEB_KIND_HOSTS[kind as ItemKind];
  if (rules === undefined) return null;
  const url = httpsUrl(v);
  if (!url) return "https";
  const host = url.hostname.toLowerCase();
  if (rules !== null && !hostMatches(host, rules)) return "site";
  // A channel lives under whatsapp.com/channel/...; a community invite is chat.whatsapp.com/<code>.
  if (kind === "WhatsAppChannel" && host !== "chat.whatsapp.com" && !url.pathname.startsWith("/channel/")) return "site";
  return null;
}

/** The kinds the editor offers under "More link types", in the order shown. */
export const MORE_KINDS: ItemKind[] = [
  "Document", "DownloadFile", "Menu", "GoogleReview", "Trustpilot", "TripAdvisor", "Vimeo", "Loom", "AppleMaps",
  "WhatsAppChannel", "Airbnb", "Etsy", "Shopify", "Amazon",
];
