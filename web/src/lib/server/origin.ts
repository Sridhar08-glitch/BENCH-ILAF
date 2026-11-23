// A state-changing request that carries the sign-in cookie must come from this app's own pages.
// SameSite=Lax alone does not stop a page on a sibling sub-domain, so the Origin (or Referer) host is checked as well.
import { WEB_URL } from "@/lib/config";

type HeaderReader = { get(name: string): string | null };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/** "app.example.com" and "www.app.example.com" count as the same site. */
function withVariants(host: string | null): string[] {
  if (!host) return [];
  return host.startsWith("www.") ? [host, host.slice(4)] : [host, `www.${host}`];
}

/** The hosts a request may legitimately come from: the host it was sent to and the configured public address. */
export function allowedHosts(h: HeaderReader, webUrl: string = WEB_URL): Set<string> {
  const out = new Set<string>();
  for (const v of [h.get("host"), hostOf(webUrl)]) {
    for (const x of withVariants(v ? v.toLowerCase() : null)) out.add(x);
  }
  return out;
}

/** True when the request may go ahead. Reading (GET, HEAD) is always allowed. */
export function originAllowed(method: string, h: HeaderReader, webUrl: string = WEB_URL): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  const allowed = allowedHosts(h, webUrl);
  const origin = h.get("origin");
  if (origin) return allowed.has(hostOf(origin) ?? "\0");
  const referer = hostOf(h.get("referer"));
  if (referer) return allowed.has(referer);
  // Browsers always send Origin on a cross-origin write; with neither header the request did not come from a page of this app.
  return false;
}

export const ORIGIN_REFUSED = {
  error: { code: "origin_refused", message: "This request did not come from the app. Reload the page and try again." },
} as const;
