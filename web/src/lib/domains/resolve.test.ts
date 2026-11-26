import { describe, expect, it, vi } from "vitest";
import { MAX_ENTRIES, TTL_ACTIVE_MS, TTL_OTHER_MS, createResolver } from "./resolve";

const reply = (body: unknown, ok = true) => async (url?: string) => ({ ok, url, json: async () => body });

describe("host resolver", () => {
  it("asks the API with the host, keeps an answer briefly, then asks again", async () => {
    let t = 1000;
    const fetcher = vi.fn(reply({ verified: true, state: "active", workspace: "ws_1", kind: "directory", directory_slug: "acme", company_card: null }));
    const resolve = createResolver({ apiUrl: "https://api.bench.qa/api/v1/", fetcher, now: () => t });
    const first = await resolve("cards.acme.com");
    expect(first).toMatchObject({ verified: true, state: "active", workspace: "ws_1", kind: "directory", directory_slug: "acme" });
    expect(fetcher.mock.calls[0][0]).toBe("https://api.bench.qa/api/v1/domains/resolve?host=cards.acme.com");
    await resolve("cards.acme.com");
    expect(fetcher).toHaveBeenCalledTimes(1);
    t += TTL_ACTIVE_MS + 1;
    await resolve("cards.acme.com");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps unknown hosts for a shorter time", async () => {
    let t = 0;
    const fetcher = vi.fn(reply({ verified: false, state: "unknown" }));
    const resolve = createResolver({ apiUrl: "http://api", fetcher, now: () => t });
    await resolve("x.example.com");
    t += TTL_OTHER_MS + 1;
    await resolve("x.example.com");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("never keeps a failure: an API error or a timeout is null and asked again next time", async () => {
    const fetcher = vi.fn().mockImplementationOnce(reply({}, false)).mockRejectedValueOnce(new Error("timeout")).mockImplementation(reply({ verified: true, state: "active" }));
    const resolve = createResolver({ apiUrl: "http://api", fetcher });
    expect(await resolve("a.example.com")).toBeNull();
    expect(await resolve("a.example.com")).toBeNull();
    expect(await resolve("a.example.com")).toMatchObject({ state: "active" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not trust odd answers", async () => {
    const resolve = createResolver({ apiUrl: "http://api", fetcher: reply({ verified: "yes", state: "root", workspace: 5, kind: "admin", directory_slug: 3 }) });
    expect(await resolve("odd.example.com")).toEqual({
      verified: false, state: "unknown", workspace: undefined, kind: undefined, directory_enabled: false, directory_slug: null, company_card: null,
    });
  });
  it("is bounded", async () => {
    const fetcher = vi.fn(reply({ verified: false, state: "unknown" }));
    const resolve = createResolver({ apiUrl: "http://api", fetcher });
    for (let i = 0; i < MAX_ENTRIES + 20; i++) await resolve(`h${i}.example.com`);
    await resolve("h0.example.com"); // evicted long ago: asked again
    expect(fetcher).toHaveBeenCalledTimes(MAX_ENTRIES + 21);
  });
});
