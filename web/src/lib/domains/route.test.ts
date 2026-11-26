import { describe, expect, it } from "vitest";
import {
  CUSTOM_HOST_HEADER, CUSTOM_ROOT_HEADER, CUSTOM_WS_HEADER, classifyHost, decideCustom, decideMain, isStaticPath, normaliseHost, routeRequest,
  type Decision, type Resolution, type RouteInput,
} from "./route";

const WEB = "https://app.bench.qa";
const DIRECTORY: Resolution = { verified: true, state: "active", workspace: "ws_abc", kind: "directory", directory_enabled: true, directory_slug: "northgate-people", company_card: "ccccccccc2" };
const COMPANY_CARD: Resolution = { verified: true, state: "active", workspace: "ws_abc", kind: "card", directory_enabled: false, directory_slug: null, company_card: "ccccccccc2" };
const NOTHING: Resolution = { verified: true, state: "active", workspace: "ws_abc", kind: "none", directory_enabled: false, directory_slug: null, company_card: null };
const LAPSED: Resolution = { verified: false, state: "inactive" };
const UNKNOWN: Resolution = { verified: false, state: "unknown" };

const input = (over: Partial<RouteInput> = {}): RouteInput => ({ host: "cards.northgate.com", pathname: "/", search: "", signedIn: false, webUrl: WEB, ...over });
const decide = (res: Resolution | null, over: Partial<RouteInput> = {}) => decideCustom(input(over), "cards.northgate.com", res);

describe("host classes", () => {
  it("knows the Bench host, www, local hosts and a missing host", () => {
    for (const h of ["app.bench.qa", "APP.bench.qa:443", "www.app.bench.qa", "localhost:3100", "127.0.0.1:3100", "foo.localhost", "", null, undefined]) {
      expect(classifyHost(h, WEB), String(h)).toBe("main");
    }
    expect(classifyHost("cards.northgate.com", WEB)).toBe("custom");
    expect(classifyHost("Cards.Northgate.com.", WEB)).toBe("custom");
    expect(classifyHost("bench.example.org", WEB, ["bench.example.org"])).toBe("main");
  });
  it("calls things that cannot be a domain invalid", () => {
    for (const h of ["203.0.113.9", "bad host", "-x.example.com", "a.b", "exa_mple.com", "x".repeat(300) + ".com", "[2001:db8::1]"]) {
      expect(classifyHost(h, WEB), h).toBe("invalid");
    }
  });
  it("normalises", () => {
    expect(normaliseHost(" Cards.Northgate.COM:8443. ")).toBe("cards.northgate.com");
    expect(normaliseHost(null)).toBe("");
  });
});

describe("the Bench host", () => {
  it("sends a signed-out visitor of /app or /staff to sign-in, with a way back", () => {
    const d = decideMain({ pathname: "/app/cards", search: "?x=1", signedIn: false });
    expect(d).toEqual({ type: "redirect", location: "/login?next=%2Fapp%2Fcards%3Fx%3D1", status: 307 });
    expect(decideMain({ pathname: "/staff", search: "", signedIn: false }).type).toBe("redirect");
    expect(decideMain({ pathname: "/app", search: "", signedIn: false }).type).toBe("redirect");
  });
  it("lets a signed-in visitor and every public page through, and never trusts our private headers", () => {
    expect(decideMain({ pathname: "/app", search: "", signedIn: true }).type).toBe("next");
    for (const p of ["/", "/login", "/c/ahmed", "/d/northgate", "/application", "/apple", "/api/proxy/me", "/staffing"]) {
      const d = decideMain({ pathname: p, search: "", signedIn: false });
      expect(d.type, p).toBe("next");
      expect((d as Extract<Decision, { type: "next" }>).drop).toEqual([CUSTOM_HOST_HEADER, CUSTOM_WS_HEADER, CUSTOM_ROOT_HEADER]);
    }
  });
});

describe("a verified custom domain", () => {
  it("shows the company card of a slug at the address the visitor typed", () => {
    const d = decide(DIRECTORY, { pathname: "/ahmed" });
    expect(d).toEqual({
      type: "rewrite", pathname: "/c/ahmed", search: "",
      headers: { [CUSTOM_HOST_HEADER]: "cards.northgate.com", [CUSTOM_WS_HEADER]: "ws_abc" },
    });
    expect(decide(DIRECTORY, { pathname: "/Ahmed-2/", search: "?s=qr" })).toMatchObject({ type: "rewrite", pathname: "/c/Ahmed-2", search: "?s=qr" });
    expect(decide(DIRECTORY, { pathname: "/ahmed/report" })).toMatchObject({ pathname: "/c/ahmed/report" });
    expect(decide(DIRECTORY, { pathname: "/ahmed/report/send" })).toMatchObject({ pathname: "/c/ahmed/report/send" });
    expect(decide(DIRECTORY, { pathname: "/ahmed/og.png" })).toMatchObject({ pathname: "/c/ahmed/og.png" });
  });
  it("shows the directory at / when it is on, else the company card, else nothing", () => {
    expect(decide(DIRECTORY, { pathname: "/", search: "?q=ali&page=2" })).toMatchObject({
      type: "rewrite", pathname: "/d/northgate-people", search: "?q=ali&page=2", headers: { [CUSTOM_ROOT_HEADER]: "1", [CUSTOM_HOST_HEADER]: "cards.northgate.com" },
    });
    expect(decide(COMPANY_CARD, { pathname: "/" })).toMatchObject({ type: "rewrite", pathname: "/c/ccccccccc2", headers: { [CUSTOM_ROOT_HEADER]: "1" } });
    expect(decide(NOTHING, { pathname: "/" })).toEqual({ type: "notfound" });
  });
  it("keeps /c/<code> and /d/<slug> working (the API only answers them for this company)", () => {
    expect(decide(DIRECTORY, { pathname: "/c/ahmed/report" })).toMatchObject({ type: "rewrite", pathname: "/c/ahmed/report", headers: { [CUSTOM_HOST_HEADER]: "cards.northgate.com" } });
    expect(decide(DIRECTORY, { pathname: "/d/northgate-people" })).toMatchObject({ type: "rewrite", pathname: "/d/northgate-people" });
  });
  it("never serves the dashboard, sign-in or staff area: they go to the Bench host", () => {
    for (const p of ["/app", "/app/cards", "/staff", "/staff/x", "/login", "/register", "/forgot", "/reset/abc", "/join/abc", "/restore/abc", "/data-download/t", "/verify-domain/t", "/terms", "/privacy", "/order/123"]) {
      const d = decide(DIRECTORY, { pathname: p, search: "?next=1" });
      expect(d, p).toEqual({ type: "redirect", location: `${WEB}${p}?next=1`, status: 302 });
    }
  });
  it("answers only the two harmless /api routes, never the proxy or session routes", () => {
    expect(decide(DIRECTORY, { pathname: "/api/icons/github" }).type).toBe("rewrite");
    expect(decide(DIRECTORY, { pathname: "/api/brand-info" }).type).toBe("rewrite");
    for (const p of ["/api/proxy/me", "/api/session/login", "/api", "/api/other"]) expect(decide(DIRECTORY, { pathname: p }), p).toEqual({ type: "notfound" });
  });
  it("says not found to everything else", () => {
    for (const p of ["/ahmed/unknown", "/a", "/ahmed/report/extra", "/x y", "/.env", "/wp-admin/setup.php", "/ahmed.vcf"]) expect(decide(DIRECTORY, { pathname: p }), p).toEqual({ type: "notfound" });
  });
});

describe("a custom domain that is not live", () => {
  it("unknown or unverified hosts get a neutral not found", () => {
    for (const p of ["/", "/ahmed", "/app", "/c/ahmed", "/login"]) expect(decide(UNKNOWN, { pathname: p }), p).toEqual({ type: "notfound" });
    expect(decide({ verified: false, state: "active" }, { pathname: "/ahmed" })).toEqual({ type: "notfound" });
  });
  it("a lapsed plan sends the visitor to the same card on the Bench address", () => {
    expect(decide(LAPSED, { pathname: "/ahmed", search: "?s=nfc" })).toEqual({ type: "redirect", location: `${WEB}/c/ahmed?s=nfc`, status: 302 });
    expect(decide(LAPSED, { pathname: "/ahmed/report" })).toMatchObject({ location: `${WEB}/c/ahmed/report` });
    expect(decide(LAPSED, { pathname: "/c/ahmed" })).toMatchObject({ location: `${WEB}/c/ahmed` });
    expect(decide(LAPSED, { pathname: "/" })).toEqual({ type: "redirect", location: `${WEB}/`, status: 302 });
    expect(decide(LAPSED, { pathname: "/app" })).toEqual({ type: "notfound" });
    expect(decide(LAPSED, { pathname: "/api/proxy/x" })).toEqual({ type: "notfound" });
  });
  it("an API that cannot be reached is a 503, not a guess", () => {
    expect(decide(null, { pathname: "/ahmed" })).toEqual({ type: "unavailable" });
  });
});

describe("static files", () => {
  it("are served on every host without asking the API", () => {
    for (const p of ["/_next/static/chunk.js", "/card-library/card.css", "/card-fonts/a.woff2", "/brand/logo.png", "/sw.js", "/manifest.webmanifest", "/favicon.ico", "/robots.txt"]) {
      expect(isStaticPath(p), p).toBe(true);
      expect(decide(null, { pathname: p }).type, p).toBe("next");
    }
    expect(isStaticPath("/ahmed")).toBe(false);
    expect(isStaticPath("/_nextish")).toBe(false);
  });
});

// ---- the middleware's whole decision with a fake API (the integration the task asks for)
describe("routeRequest", () => {
  const calls: string[] = [];
  const api = async (host: string): Promise<Resolution | null> => {
    calls.push(host);
    if (host === "cards.northgate.com") return DIRECTORY;
    if (host === "old.northgate.com") return LAPSED;
    if (host === "down.example.com") return null;
    return UNKNOWN;
  };
  const run = (over: Partial<RouteInput>) => { calls.length = 0; return routeRequest(input(over), api); };

  it("main host: the dashboard needs a sign-in, a card page does not, and the API is never asked", async () => {
    expect(await run({ host: "app.bench.qa", pathname: "/app" })).toMatchObject({ type: "redirect", location: "/login?next=%2Fapp" });
    expect(await run({ host: "app.bench.qa", pathname: "/app", signedIn: true })).toMatchObject({ type: "next" });
    expect(await run({ host: "app.bench.qa", pathname: "/c/ahmed" })).toMatchObject({ type: "next" });
    expect(calls).toEqual([]);
  });
  it("custom host, verified: a card, the root, and a request for /app", async () => {
    expect(await run({ pathname: "/ahmed" })).toMatchObject({ type: "rewrite", pathname: "/c/ahmed" });
    expect(await run({ pathname: "/" })).toMatchObject({ type: "rewrite", pathname: "/d/northgate-people" });
    expect(await run({ pathname: "/app/cards", signedIn: true })).toEqual({ type: "redirect", location: `${WEB}/app/cards`, status: 302 });
    expect(await run({ pathname: "/staff", signedIn: true })).toMatchObject({ type: "redirect", location: `${WEB}/staff` });
  });
  it("unknown host: not found for pages, but static files still load (and cost no API call)", async () => {
    expect(await run({ host: "nobody.example.com", pathname: "/ahmed" })).toEqual({ type: "notfound" });
    expect(await run({ host: "nobody.example.com", pathname: "/_next/static/a.css" })).toMatchObject({ type: "next" });
    expect(calls).toEqual([]);
  });
  it("invalid host and API outage", async () => {
    expect(await run({ host: "203.0.113.9", pathname: "/ahmed" })).toEqual({ type: "notfound" });
    expect(calls).toEqual([]);
    expect(await run({ host: "down.example.com", pathname: "/ahmed" })).toEqual({ type: "unavailable" });
  });
  it("lapsed domain redirects to Bench", async () => {
    expect(await run({ host: "old.northgate.com", pathname: "/ahmed" })).toMatchObject({ type: "redirect", location: `${WEB}/c/ahmed` });
  });
  it("host with a port or different case resolves the same", async () => {
    expect(await run({ host: "Cards.Northgate.com:443", pathname: "/ahmed" })).toMatchObject({ type: "rewrite" });
    expect(calls).toEqual(["cards.northgate.com"]);
  });
});
