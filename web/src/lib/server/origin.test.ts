import { describe, expect, it } from "vitest";
import { allowedHosts, originAllowed } from "./origin";

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
const WEB = "https://app.example.com";

describe("origin check for state-changing requests", () => {
  it("lets reads through whatever the origin", () => {
    expect(originAllowed("GET", h({ origin: "https://evil.test", host: "app.example.com" }), WEB)).toBe(true);
    expect(originAllowed("HEAD", h({}), WEB)).toBe(true);
  });

  it("accepts a write from the app's own host (the host it was sent to, or the configured web address)", () => {
    expect(originAllowed("POST", h({ origin: "https://app.example.com", host: "app.example.com" }), WEB)).toBe(true);
    expect(originAllowed("PATCH", h({ origin: "https://app.example.com", host: "127.0.0.1:3101" }), WEB)).toBe(true);
    expect(originAllowed("DELETE", h({ origin: "http://localhost:3100", host: "localhost:3100" }), "http://localhost:3100")).toBe(true);
  });

  it("accepts the www variant of the configured host", () => {
    expect(originAllowed("POST", h({ origin: "https://www.app.example.com", host: "app.example.com" }), WEB)).toBe(true);
  });

  it("refuses a write from another site, a sibling sub-domain, a different port and the null origin", () => {
    expect(originAllowed("POST", h({ origin: "https://evil.test", host: "app.example.com" }), WEB)).toBe(false);
    expect(originAllowed("POST", h({ origin: "https://x.example.com", host: "app.example.com" }), WEB)).toBe(false);
    expect(originAllowed("PUT", h({ origin: "https://app.example.com:8443", host: "app.example.com" }), WEB)).toBe(false);
    expect(originAllowed("POST", h({ origin: "null", host: "app.example.com" }), WEB)).toBe(false);
  });

  it("falls back to the Referer when there is no Origin", () => {
    expect(originAllowed("POST", h({ referer: "https://app.example.com/app/cards", host: "app.example.com" }), WEB)).toBe(true);
    expect(originAllowed("POST", h({ referer: "https://evil.test/page", host: "app.example.com" }), WEB)).toBe(false);
  });

  it("refuses a write that carries neither header", () => {
    expect(originAllowed("POST", h({ host: "app.example.com" }), WEB)).toBe(false);
  });

  it("builds the allowed set from the host header and the web address", () => {
    const set = allowedHosts(h({ host: "app.example.com" }), "https://other.example.org");
    expect([...set].sort()).toEqual(["app.example.com", "other.example.org", "www.app.example.com", "www.other.example.org"]);
  });
});
