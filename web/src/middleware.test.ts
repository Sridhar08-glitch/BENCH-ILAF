import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

// The real middleware, with the API faked: what the visitor of each kind of host receives.
const WEB = "http://localhost:3100"; // WEB_URL default in the tests

function api(answers: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const host = new URL(String(url)).searchParams.get("host") ?? "";
    return { ok: true, json: async () => answers[host] ?? { verified: false, state: "unknown" } };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const req = (host: string, path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://${host}${path}`, { headers: { host, ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe("middleware", () => {
  it("main host: /app without a sign-in goes to /login, a card page passes, nothing is asked of the API", async () => {
    const f = api({});
    const res = await middleware(req("localhost:3100", "/app/cards"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${WEB}/login?next=%2Fapp%2Fcards`);
    const ok = await middleware(req("localhost:3100", "/c/ahmed"));
    expect(ok.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });

  it("main host: a visitor cannot pretend to be on a company's domain by sending our headers", async () => {
    api({});
    const res = await middleware(req("localhost:3100", "/c/ahmed", { "x-bench-custom-host": "cards.victim.com" }));
    // The forwarded request headers are listed in x-middleware-request-*; the spoofed one is not among the kept ones.
    expect(res.headers.get("x-middleware-override-headers") ?? "").not.toContain("x-bench-custom-host");
    expect(res.headers.get("x-middleware-request-x-bench-custom-host")).toBeNull();
  });

  it("verified custom host: /ahmed is rewritten to the card with the host header set; the URL the visitor typed stays", async () => {
    api({ "cards.northgate.com": { verified: true, state: "active", workspace: "ws_1", kind: "directory", directory_slug: "northgate" } });
    const res = await middleware(req("cards.northgate.com", "/ahmed?s=qr"));
    expect(res.headers.get("x-middleware-rewrite")).toBe("http://cards.northgate.com/c/ahmed?s=qr");
    expect(res.headers.get("x-middleware-request-x-bench-custom-host")).toBe("cards.northgate.com");
    expect(res.headers.get("x-middleware-request-x-bench-custom-ws")).toBe("ws_1");
    const root = await middleware(req("cards.northgate.com", "/"));
    expect(root.headers.get("x-middleware-rewrite")).toBe("http://cards.northgate.com/d/northgate");
    expect(root.headers.get("x-middleware-request-x-bench-custom-root")).toBe("1");
  });

  it("custom host asking for /app is sent to the Bench host, signed in or not", async () => {
    api({ "cards.northgate.com": { verified: true, state: "active", workspace: "ws_1", kind: "none" } });
    for (const cookie of [{} as Record<string, string>, { cookie: "ilaf_rt=x" }]) {
      const res = await middleware(req("cards.northgate.com", "/app/cards", cookie));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`${WEB}/app/cards`);
    }
  });

  it("unknown host: 404 page, and a lapsed one redirects to the card on Bench", async () => {
    api({ "old.northgate.com": { verified: false, state: "inactive" } });
    const unknown = await middleware(req("who.example.com", "/ahmed"));
    expect(unknown.headers.get("x-middleware-rewrite")).toContain("/_bench-not-found");
    expect(unknown.headers.get("x-robots-tag")).toBe("noindex");
    const lapsed = await middleware(req("old.northgate.com", "/ahmed"));
    expect(lapsed.status).toBe(302);
    expect(lapsed.headers.get("location")).toBe(`${WEB}/c/ahmed`);
  });

  it("an API that cannot be reached gives 503", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const res = await middleware(req("cards.down-example.com", "/ahmed"));
    expect(res.status).toBe(503);
  });
});
