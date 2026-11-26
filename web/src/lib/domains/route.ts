// Which request is for which site. The same Next app answers on the Bench host (the website and the dashboard) and, once a company
// verified its own domain (Enterprise), on that domain, where only that company's public cards and directory are served.
// Everything here is a pure function so the decision can be tested without a server; src/middleware.ts only turns a Decision into a response.

/** What `GET /domains/resolve?host=` answers (see API_CONTRACT.md). */
export interface Resolution {
  verified: boolean;
  /** active: serve it; inactive: a verified domain whose plan lapsed (or an erased company); unknown: nobody holds it. */
  state: "active" | "inactive" | "unknown";
  /** An opaque id of the company (not the database id). */
  workspace?: string;
  /** What "/" shows: the company directory, the company card, or nothing. */
  kind?: "directory" | "card" | "none";
  directory_enabled?: boolean;
  directory_slug?: string | null;
  company_card?: string | null;
}

export type HostClass = "main" | "custom" | "invalid";

/** The header the middleware sets on a request it serves for a custom domain; the pages pass it to the API as `?host=` so the API only
 *  ever returns that company's cards. The middleware removes it from every request that did not earn it. */
export const CUSTOM_HOST_HEADER = "x-bench-custom-host";
export const CUSTOM_WS_HEADER = "x-bench-custom-ws";
/** Set to "1" when the visitor asked for the root ("/") and was given the company card or directory under it (so the page does not redirect). */
export const CUSTOM_ROOT_HEADER = "x-bench-custom-root";
/** Every header only the middleware may set. */
export const CUSTOM_HEADERS = [CUSTOM_HOST_HEADER, CUSTOM_WS_HEADER, CUSTOM_ROOT_HEADER] as const;

export interface RouteInput {
  /** The Host header (with or without a port). */
  host: string | null | undefined;
  pathname: string;
  /** Including the leading "?" or empty. */
  search: string;
  /** The sign-in cookie is present (the dashboard's own check; the API still verifies it). */
  signedIn: boolean;
  /** The public address of the Bench web app, e.g. https://app.bench.qa (no trailing slash). */
  webUrl: string;
  /** More hosts that are the Bench site itself (www, a second name), lower case. */
  extraMainHosts?: readonly string[];
}

export type Decision =
  | { type: "next"; /** request headers to remove */ drop?: readonly string[] }
  | { type: "redirect"; location: string; status: 301 | 302 | 307 | 308 }
  | { type: "rewrite"; pathname: string; search: string; headers: Record<string, string> }
  | { type: "notfound" }
  | { type: "unavailable" };

const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** "Cards.Example.com:443." -> "cards.example.com". Empty when there is no host. */
export function normaliseHost(host: string | null | undefined): string {
  let h = (host ?? "").trim().toLowerCase();
  h = h.replace(/\.$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  return h;
}

export function hostOf(url: string): string {
  try {
    return normaliseHost(new URL(url).host);
  } catch {
    return "";
  }
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0|[^.]+\.localhost)$/;

/** main: the Bench site (its configured host, www of it, any local development host, or a request without a Host header);
 *  custom: a name that may be a company's domain; invalid: not something a domain can be (an IP address, odd characters). */
export function classifyHost(host: string | null | undefined, webUrl: string, extra: readonly string[] = []): HostClass {
  const h = normaliseHost(host);
  if (!h) return "main"; // no Host header at all: a health probe, never a visitor of a custom domain
  const own = hostOf(webUrl);
  if (h === own || h === `www.${own}` || extra.includes(h) || LOCAL.test(h)) return "main";
  if (/^[0-9.]+$/.test(h) || h.includes(":") || !HOST_RE.test(h)) return "invalid";
  return "custom";
}

// ---------------------------------------------------------------- the Bench host
const PRIVATE_AREA = /^\/(app|staff)(\/|$)/;
const DROP = CUSTOM_HEADERS;

export function decideMain(input: Pick<RouteInput, "pathname" | "search" | "signedIn">): Decision {
  // Whatever arrives on the Bench host never carries the custom-domain headers: a visitor cannot make a page think it is on someone's domain.
  if (PRIVATE_AREA.test(input.pathname) && !input.signedIn) {
    return { type: "redirect", location: `/login?next=${encodeURIComponent(input.pathname + input.search)}`, status: 307 };
  }
  return { type: "next", drop: DROP };
}

// ---------------------------------------------------------------- a custom domain
/** Static files and framework paths: served the same on every host (they hold nothing about any company). */
const STATIC_FIRST = new Set(["_next", "card-library", "card-fonts", "og-fonts", "brand", "sw.js", "sw-rules.js", "manifest.webmanifest", "favicon.ico", "robots.txt"]);
/** Pages of the Bench site that must not be served under a company's name: the dashboard, sign-in, staff area, legal and tools. */
const MAIN_ONLY = new Set([
  "app", "staff", "login", "register", "forgot", "reset", "join", "restore", "data-download", "verify-domain", "request-access",
  "contact", "developers", "terms", "privacy", "preview", "order", "unsubscribe", "offline", "signup", "logout", "admin", "pricing",
]);
/** The only /api routes a visitor of a card needs. Everything else (/api/proxy, /api/session, ...) is the dashboard's. */
const API_OK = new Set(["icons", "brand-info"]);
/** A card address: its slug or permanent code. The API lower-cases and checks; this only keeps odd paths out. */
const CARD_KEY = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/i;
/** Under a card: the report page, its form post and the sharing picture. */
const CARD_SUBPATHS = new Set(["", "/report", "/report/send", "/og.png"]);

function onMain(webUrl: string, pathname: string, search: string): string {
  return `${webUrl.replace(/\/+$/, "")}${pathname}${search}`;
}

function scoped(res: Resolution, host: string, root = false): Record<string, string> {
  return { [CUSTOM_HOST_HEADER]: host, ...(res.workspace ? { [CUSTOM_WS_HEADER]: res.workspace } : {}), ...(root ? { [CUSTOM_ROOT_HEADER]: "1" } : {}) };
}

/** True for paths that need no answer from the API (static files). */
export function isStaticPath(pathname: string): boolean {
  return STATIC_FIRST.has(pathname.split("/")[1] ?? "");
}

/** What to do with a request on a host that is not the Bench host. `res` is null when the API could not be asked. */
export function decideCustom(input: Pick<RouteInput, "pathname" | "search" | "webUrl">, host: string, res: Resolution | null): Decision {
  const { pathname, search, webUrl } = input;
  if (isStaticPath(pathname)) return { type: "next", drop: DROP };
  if (res === null) return { type: "unavailable" };
  if (res.state === "inactive") {
    // The company's plan lapsed: its cards are still on the Bench address. Anything else is nothing.
    if (pathname === "/") return { type: "redirect", location: webUrl.replace(/\/+$/, "") + "/", status: 302 };
    const seg = pathname.split("/")[1] ?? "";
    if (seg === "c" || seg === "d") return { type: "redirect", location: onMain(webUrl, pathname, search), status: 302 };
    if (CARD_KEY.test(seg) && !MAIN_ONLY.has(seg)) {
      const rest = pathname.slice(seg.length + 1).replace(/\/+$/, "");
      if (CARD_SUBPATHS.has(rest)) return { type: "redirect", location: onMain(webUrl, `/c/${seg}${rest}`, search), status: 302 };
    }
    return { type: "notfound" };
  }
  if (!res.verified || res.state !== "active") return { type: "notfound" };

  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const headers = scoped(res, host);
  if (clean === "/") {
    const rootHeaders = scoped(res, host, true);
    if (res.kind === "directory" && res.directory_slug) return { type: "rewrite", pathname: `/d/${res.directory_slug}`, search, headers: rootHeaders };
    if (res.kind === "card" && res.company_card) return { type: "rewrite", pathname: `/c/${res.company_card}`, search, headers: rootHeaders };
    return { type: "notfound" };
  }
  const seg = clean.split("/")[1] ?? "";
  const rest = clean.slice(seg.length + 1);
  if (MAIN_ONLY.has(seg)) return { type: "redirect", location: onMain(webUrl, pathname, search), status: 302 };
  if (seg === "api") {
    const second = clean.split("/")[2] ?? "";
    return API_OK.has(second) ? { type: "rewrite", pathname: clean, search, headers } : { type: "notfound" };
  }
  // /c/<code> and /d/<slug> work as they do on the Bench host; the API only answers them for this company (see ?host= in the pages).
  if (seg === "c" || seg === "d") return { type: "rewrite", pathname: clean, search, headers };
  if (CARD_KEY.test(seg) && CARD_SUBPATHS.has(rest)) return { type: "rewrite", pathname: `/c/${seg}${rest}`, search, headers };
  return { type: "notfound" };
}

/** The whole decision for one request. `resolve` asks the API about a host (the caller caches). */
export async function routeRequest(input: RouteInput, resolve: (host: string) => Promise<Resolution | null>): Promise<Decision> {
  const cls = classifyHost(input.host, input.webUrl, input.extraMainHosts);
  if (cls === "main") return decideMain(input);
  const host = normaliseHost(input.host);
  if (cls === "invalid") return isStaticPath(input.pathname) ? { type: "next", drop: DROP } : { type: "notfound" };
  if (isStaticPath(input.pathname)) return decideCustom(input, host, null); // no API call for a stylesheet
  return decideCustom(input, host, await resolve(host));
}
