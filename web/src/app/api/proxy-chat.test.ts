import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as proxyGet } from "./proxy/[...path]/route";

const OWN = { origin: "http://localhost:3100", host: "localhost:3100" };
let seen: Record<string, string>[];
let answer: () => Response;

beforeEach(() => {
  seen = [];
  answer = () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json", ETag: '"abc"' } });
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const h: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (h[k] = v));
    seen.push(h);
    return answer();
  });
});
afterEach(() => vi.unstubAllGlobals());

const get = (headers: Record<string, string>) =>
  proxyGet(new NextRequest("http://localhost:3100/api/proxy/support/chat/x/messages?since=0", { headers: { ...OWN, ...headers } }), {
    params: Promise.resolve({ path: ["support", "chat", "x", "messages"] }),
  });

describe("live chat through the proxy", () => {
  it("forwards the visitor's chat token and the ETag check, and hands the ETag back", async () => {
    const res = await get({ "x-chat-token": "tok123", "if-none-match": '"abc"' });
    expect(seen[0]["x-chat-token"]).toBe("tok123");
    expect(seen[0]["if-none-match"]).toBe('"abc"');
    expect(res.headers.get("etag")).toBe('"abc"');
  });

  it("answers 304 without a body", async () => {
    answer = () => new Response(null, { status: 304, headers: { ETag: '"abc"' } });
    const res = await get({ "if-none-match": '"abc"' });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("sends no chat headers when the page sent none", async () => {
    await get({});
    expect(seen[0]["x-chat-token"]).toBeUndefined();
    expect(seen[0]["if-none-match"]).toBeUndefined();
  });
});
