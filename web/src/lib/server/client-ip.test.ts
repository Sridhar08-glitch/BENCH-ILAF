import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cleanIp, visitorHeaders, visitorIp } from "./client-ip";

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

describe("visitor address", () => {
  it("accepts plain, bracketed and ported addresses and refuses the rest", () => {
    expect(cleanIp("203.0.113.9")).toBe("203.0.113.9");
    expect(cleanIp(" 203.0.113.9:5555 ")).toBe("203.0.113.9");
    expect(cleanIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(cleanIp("not an ip")).toBeNull();
    expect(cleanIp("999.1.1.1")).toBeNull();
    expect(cleanIp("")).toBeNull();
    expect(cleanIp(null)).toBeNull();
    expect(cleanIp("1".repeat(80))).toBeNull();
  });

  it("writes IPv6 in the short form the API signs, and unwraps IPv4-mapped addresses", () => {
    expect(cleanIp("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
    expect(cleanIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(cleanIp("::FFFF:CB00:7109")).toBe("203.0.113.9");
  });

  it("uses the last X-Forwarded-For entry (the one nginx wrote), never what the visitor put first", () => {
    expect(visitorIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(visitorIp(h({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("skips a garbled last entry, then falls back to X-Real-IP", () => {
    expect(visitorIp(h({ "x-forwarded-for": "203.0.113.9, garbage" }))).toBe("203.0.113.9");
    expect(visitorIp(h({ "x-forwarded-for": "garbage", "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(visitorIp(h({}))).toBeNull();
  });
});

describe("visitor headers for the API", () => {
  it("sends the address and an HMAC-SHA256 signature of it when a secret is set", () => {
    const out = visitorHeaders(h({ "x-forwarded-for": "203.0.113.9" }), "s3cret");
    expect(out["X-BENCH-Client-IP"]).toBe("203.0.113.9");
    expect(out["X-BENCH-Client-IP-Signature"]).toBe(createHmac("sha256", "s3cret").update("203.0.113.9").digest("hex"));
  });

  it("sends only the address when no secret is set, and nothing when no address is known", () => {
    expect(visitorHeaders(h({ "x-real-ip": "203.0.113.9" }), "")).toEqual({ "X-BENCH-Client-IP": "203.0.113.9" });
    expect(visitorHeaders(h({}), "s3cret")).toEqual({});
  });

  it("reads the secret from the server environment when none is passed", () => {
    const before = process.env.CLIENT_IP_HEADER_SECRET;
    process.env.CLIENT_IP_HEADER_SECRET = "from-env";
    try {
      expect(visitorHeaders(h({ "x-forwarded-for": "203.0.113.9" }))["X-BENCH-Client-IP-Signature"]).toBe(
        createHmac("sha256", "from-env").update("203.0.113.9").digest("hex"),
      );
    } finally {
      if (before === undefined) delete process.env.CLIENT_IP_HEADER_SECRET;
      else process.env.CLIENT_IP_HEADER_SECRET = before;
    }
  });
});
