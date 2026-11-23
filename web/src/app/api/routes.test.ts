import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as sessionPost } from "./session/[action]/route";
import { GET as proxyGet, POST as proxyPost } from "./proxy/[...path]/route";

const API = "http://localhost:8100/api/v1";
const SECRET = "test-secret";
const OWN = { origin: "http://localhost:3100", host: "localhost:3100" };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}
let calls: Call[];
let answer: (call: Call) => Response;

function lowerHeaders(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h).forEach((v, k) => (out[k] = v));
  return out;
}

beforeEach(() => {
  calls = [];
  process.env.CLIENT_IP_HEADER_SECRET = SECRET;
  answer = () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const call: Call = { url: String(url), method: init?.method ?? "GET", headers: lowerHeaders(init?.headers), body: init?.body instanceof ArrayBuffer ? new TextDecoder().decode(init.body) : init?.body ? String(init.body) : "" };
    calls.push(call);
    return answer(call);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CLIENT_IP_HEADER_SECRET;
});

const session = (action: string, body: unknown, headers: Record<string, string> = {}, cookie = "") =>
  sessionPost(
    new NextRequest(`http://localhost:3100/api/session/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...OWN, ...headers, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ action }) },
  );

const proxy = (method: "GET" | "POST", path: string[], headers: Record<string, string> = {}, body?: unknown, cookie = "") =>
  (method === "GET" ? proxyGet : proxyPost)(
    new NextRequest(`http://localhost:3100/api/proxy/${path.join("/")}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...OWN, ...headers, ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve({ path }) },
  );

describe("sign-in route", () => {
  it("sends the visitor address and its signature to the API on login", async () => {
    answer = () => Response.json({ user: { id: "u" }, access: "A", refresh: "R" });
    const res = await session("login", { email: "a@b.co", password: "x" }, { "x-forwarded-for": "9.9.9.9, 203.0.113.9" });
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(`${API}/auth/login`);
    expect(calls[0].headers["x-bench-client-ip"]).toBe("203.0.113.9");
    expect(calls[0].headers["x-bench-client-ip-signature"]).toBe(createHmac("sha256", SECRET).update("203.0.113.9").digest("hex"));
    // the tokens go into cookies and never into the body the page sees
    expect(res.headers.get("set-cookie")).toContain("ilaf_at=A");
    expect(JSON.stringify(await res.json())).not.toContain("refresh");
  });

  it("does the same for register, forgot-style public calls and Google", async () => {
    for (const action of ["register", "google", "restore"]) {
      calls.length = 0;
      await session(action, { email: "a@b.co" }, { "x-real-ip": "198.51.100.4" });
      expect(calls[0].headers["x-bench-client-ip"]).toBe("198.51.100.4");
    }
  });

  it("refuses a write from a foreign origin before it reaches the API", async () => {
    const res = await session("login", { email: "a@b.co", password: "x" }, { origin: "https://evil.test" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("origin_refused");
    expect(calls).toHaveLength(0);
  });

  it("passes the invitation token in the body of POST invites/accept, not in the address", async () => {
    answer = () => Response.json({ workspace_id: "w", access: "A", refresh: "R" });
    await session("accept-invite", { token: "abcdef123456", password: "pw", full_name: "N" });
    expect(calls[0].url).toBe(`${API}/invites/accept`);
    expect(JSON.parse(calls[0].body)).toEqual({ token: "abcdef123456", password: "pw", full_name: "N" });
    calls.length = 0;
    await session("accept-invite-google", { token: "abcdef123456", credential: "g" });
    expect(calls[0].url).toBe(`${API}/invites/accept-google`);
    expect(calls[0].url).not.toContain("abcdef");
  });

  it("refuses an invitation token that does not look like one", async () => {
    const res = await session("accept-invite", { token: "../x", password: "pw" });
    expect(res.status).toBe(410);
    expect(calls).toHaveLength(0);
  });

  it("passes Retry-After through when the API throttles", async () => {
    answer = () => new Response(JSON.stringify({ error: { code: "throttled", message: "slow" } }), { status: 429, headers: { "Retry-After": "17", "Content-Type": "application/json" } });
    const res = await session("login", { email: "a@b.co", password: "x" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
  });
});

describe("sign out", () => {
  it("revokes the refresh token at the API and clears both cookies", async () => {
    const res = await session("logout", {}, {}, "ilaf_at=A; ilaf_rt=R-token");
    expect(calls[0].url).toBe(`${API}/auth/logout`);
    expect(JSON.parse(calls[0].body)).toEqual({ refresh: "R-token" });
    const cookies = res.headers.get("set-cookie") ?? "";
    expect(cookies).toMatch(/ilaf_at=;/);
    expect(cookies).toMatch(/ilaf_rt=;/);
  });

  it("clears the cookies even when the API cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    const res = await session("logout", {}, {}, "ilaf_rt=R-token");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/ilaf_rt=;/);
  });

  it("clears the cookies even when the API refuses", async () => {
    answer = () => new Response("{}", { status: 500 });
    const res = await session("logout", {}, {}, "ilaf_rt=R-token");
    expect(res.headers.get("set-cookie")).toMatch(/ilaf_at=;/);
  });
});

describe("proxy route", () => {
  it("adds the visitor address and the token, and drops X-BENCH headers the browser sent", async () => {
    await proxy("GET", ["auth", "me"], { "x-forwarded-for": "203.0.113.9", "x-bench-client-ip": "6.6.6.6", "x-bench-client-ip-signature": "forged" }, undefined, "ilaf_at=TOKEN");
    expect(calls[0].headers["x-bench-client-ip"]).toBe("203.0.113.9");
    expect(calls[0].headers["x-bench-client-ip-signature"]).toBe(createHmac("sha256", SECRET).update("203.0.113.9").digest("hex"));
    expect(calls[0].headers.authorization).toBe("Bearer TOKEN");
  });

  it("sends no X-BENCH header at all when the address is unknown, even if the browser sent one", async () => {
    await proxy("GET", ["auth", "me"], { "x-bench-client-ip": "6.6.6.6" }, undefined, "ilaf_at=TOKEN");
    expect(calls[0].headers["x-bench-client-ip"]).toBeUndefined();
  });

  it("refuses POST from a foreign origin or without Origin, and lets GET through", async () => {
    const bad = await proxy("POST", ["workspaces"], { origin: "https://evil.test" }, { name: "x" }, "ilaf_at=T");
    expect(bad.status).toBe(403);
    expect((await bad.json()).error.code).toBe("origin_refused");
    const none = await proxyPost(
      new NextRequest("http://localhost:3100/api/proxy/workspaces", { method: "POST", headers: { host: "localhost:3100", "Content-Type": "application/json" }, body: "{}" }),
      { params: Promise.resolve({ path: ["workspaces"] }) },
    );
    expect(none.status).toBe(403);
    expect(calls).toHaveLength(0);
    const ok = await proxy("GET", ["me", "workspaces"], { origin: "https://evil.test" }, undefined, "ilaf_at=T");
    expect(ok.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("stores the tokens of a password change in the cookies and keeps them out of the answer", async () => {
    answer = () => Response.json({ access: "NEW-A", refresh: "NEW-R" });
    const res = await proxy("POST", ["auth", "change-password"], {}, { old_password: "a", new_password: "b" }, "ilaf_at=OLD; ilaf_rt=OLDR");
    expect(res.status).toBe(204);
    const cookies = res.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("ilaf_at=NEW-A");
    expect(cookies).toContain("ilaf_rt=NEW-R");
    expect(await res.text()).toBe("");
  });

  it("leaves the cookies alone when the password change fails", async () => {
    answer = () => new Response(JSON.stringify({ error: { code: "validation_error", message: "no" } }), { status: 400, headers: { "Content-Type": "application/json" } });
    const res = await proxy("POST", ["auth", "change-password"], {}, { old_password: "a", new_password: "b" }, "ilaf_at=OLD");
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("passes Retry-After and X-Rows-Truncated back to the page", async () => {
    answer = () => new Response("a,b", { status: 200, headers: { "Content-Type": "text/csv", "X-Rows-Truncated": "1" } });
    const res = await proxy("GET", ["workspaces", "w", "leads.csv"], {}, undefined, "ilaf_at=T");
    expect(res.headers.get("x-rows-truncated")).toBe("1");
    answer = () => new Response("{}", { status: 429, headers: { "Retry-After": "60" } });
    const throttled = await proxy("POST", ["workspaces", "w", "webhooks", "x", "test"], {}, {}, "ilaf_at=T");
    expect(throttled.headers.get("retry-after")).toBe("60");
  });

  it("sends a token in the body for the data download, and refuses a foreign origin there too", async () => {
    answer = () => new Response("zip", { status: 200, headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="x.zip"' } });
    const ok = await proxy("POST", ["privacy", "download"], {}, { token: "tok-123456" });
    expect(ok.headers.get("content-disposition")).toContain("x.zip");
    expect(calls[0].url).toBe(`${API}/privacy/download`);
    expect(calls[0].body).toContain("tok-123456");
  });
});
