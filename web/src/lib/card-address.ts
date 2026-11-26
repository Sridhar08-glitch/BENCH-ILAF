// How a card's address is shown and linked. The API builds `public_url` (the company's own domain once it is verified, else the Bench
// address <web>/c/<code>); screens that only DISPLAY the short form use these helpers, so the domain shows up everywhere at once.
import { PUBLIC_HOST } from "@/lib/config";

interface HasAddress {
  public_url?: string | null;
  slug?: string | null;
  public_code: string;
}

/** The host a card's address shows: the company's own domain once it is verified (public_url is built on it), else the short host. */
export function addressHost(card: Pick<HasAddress, "public_url">, shortHost: string = PUBLIC_HOST): string {
  const url = card.public_url ?? "";
  try {
    const u = new URL(url);
    if (url && !u.pathname.startsWith("/c/")) return u.host;
  } catch {
    // not an absolute address: the short host
  }
  return shortHost;
}

/** "cards.northgate.com/ahmed" for a card on its company's domain, else "<short host>/ahmed". No scheme, for display. */
export function shortAddress(card: HasAddress, shortHost: string = PUBLIC_HOST): string {
  return `${addressHost(card, shortHost)}/${card.slug ?? card.public_code}`;
}

/** The link of a page under a card, on the host the visitor is on: "/ahmed/report" on a company domain, "/c/ahmed/report" on Bench. */
export function cardHref(canonical: string, customHost: string | null, rest = ""): string {
  const key = encodeURIComponent(canonical);
  return customHost ? `/${key}${rest}` : `/c/${key}${rest}`;
}

/** The address of the company directory: its domain's root when it has one, else /d/<slug> on the Bench host. */
export function directoryHref(slug: string, customHost: string | null): string {
  return customHost ? "/" : `/d/${slug}`;
}
