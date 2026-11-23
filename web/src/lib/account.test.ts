import { describe, expect, it } from "vitest";
import type { DataRequest } from "./account-api";
import { googleErrorText as googleErrorTextT } from "./google";
import { createI18n } from "./i18n";
import { en } from "./i18n/messages";
import { isAppleDevice, isGoogleSaveUrl } from "./wallet";
import { confirmMatches, daysUntil, decodeToken, exportState, formatSize, latestExport, looksLikeDomain, parseDomains, timeLeft as timeLeftT, privacyErrorText as privacyErrorTextT } from "./privacy";

const { t } = createI18n("en", "latn", en);
const timeLeft = (iso: string | null, now: number) => timeLeftT(iso, t, now);
const privacyErrorText = (code: string, fallback: string) => privacyErrorTextT(code, fallback, t);
const googleErrorText = (code: string, fallback: string) => googleErrorTextT(code, fallback, t);

const NOW = Date.parse("2026-01-10T12:00:00Z");

function req(over: Partial<DataRequest>): DataRequest {
  return {
    id: "r1", kind: "export", scope: "user", workspace_id: null, workspace_name: null, status: "ready",
    requested_at: "2026-01-10T10:00:00Z", due_at: "2026-02-09T10:00:00Z", completed_at: null, ready_at: "2026-01-10T10:01:00Z",
    expires_at: "2026-01-11T10:01:00Z", download_available: true, file_size: 2048, scheduled_for: null, error: null, ...over,
  };
}

describe("exportState", () => {
  it("covers every stage", () => {
    expect(exportState(undefined, NOW)).toBe("none");
    expect(exportState(req({ status: "pending" }), NOW)).toBe("preparing");
    expect(exportState(req({ status: "processing" }), NOW)).toBe("preparing");
    expect(exportState(req({}), NOW)).toBe("ready");
    expect(exportState(req({ status: "completed" }), NOW)).toBe("used");
    expect(exportState(req({ status: "expired" }), NOW)).toBe("expired");
    expect(exportState(req({ status: "failed" }), NOW)).toBe("failed");
  });
  it("treats a ready export past its expiry as expired", () => {
    expect(exportState(req({ expires_at: "2026-01-10T11:00:00Z" }), NOW)).toBe("expired");
    expect(exportState(req({ download_available: false }), NOW)).toBe("expired");
  });
  it("ignores deletion requests", () => {
    expect(exportState(req({ kind: "delete" }), NOW)).toBe("none");
  });
});

describe("latestExport", () => {
  it("picks the newest export of the right scope", () => {
    const list = [
      req({ id: "old", requested_at: "2026-01-01T00:00:00Z" }),
      req({ id: "new", requested_at: "2026-01-09T00:00:00Z" }),
      req({ id: "co", scope: "workspace", workspace_id: "w1", requested_at: "2026-01-10T00:00:00Z" }),
      req({ id: "del", kind: "delete", requested_at: "2026-01-10T01:00:00Z" }),
    ];
    expect(latestExport(list)?.id).toBe("new");
    expect(latestExport(list, "w1")?.id).toBe("co");
    expect(latestExport(list, "w2")).toBeUndefined();
    expect(latestExport(undefined)).toBeUndefined();
  });
});

describe("dates and sizes", () => {
  it("counts days left, rounded up and never negative", () => {
    expect(daysUntil("2026-01-24T12:00:00Z", NOW)).toBe(14);
    expect(daysUntil("2026-01-10T13:00:00Z", NOW)).toBe(1);
    expect(daysUntil("2026-01-09T13:00:00Z", NOW)).toBe(0);
    expect(daysUntil(null, NOW)).toBe(0);
  });
  it("says how long a link lasts", () => {
    expect(timeLeft("2026-01-11T12:00:00Z", NOW)).toBe("24 hours");
    expect(timeLeft("2026-01-10T13:00:00Z", NOW)).toBe("1 hour");
    expect(timeLeft("2026-01-10T12:01:00Z", NOW)).toBe("1 minute");
    expect(timeLeft("2026-01-10T12:30:00Z", NOW)).toBe("30 minutes");
  });
  it("formats sizes", () => {
    expect(formatSize(500)).toBe("500 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("confirmation text", () => {
  it("needs an exact match", () => {
    expect(confirmMatches("DELETE", "DELETE")).toBe(true);
    expect(confirmMatches("  DELETE ", "DELETE")).toBe(true);
    expect(confirmMatches("delete", "DELETE")).toBe(false);
    expect(confirmMatches("", "")).toBe(false);
    expect(confirmMatches("acme ltd", "Acme Ltd")).toBe(false);
    expect(confirmMatches("Acme Ltd", "Acme Ltd")).toBe(true);
  });
});

describe("company domains", () => {
  it("cleans a typed list", () => {
    expect(parseDomains("@Northgate.com, north.co.uk\nnorthgate.com;  ")).toEqual(["northgate.com", "north.co.uk"]);
    expect(parseDomains("")).toEqual([]);
  });
  it("recognises domains", () => {
    expect(looksLikeDomain("northgate.com")).toBe(true);
    expect(looksLikeDomain("mail.north.co.uk")).toBe(true);
    expect(looksLikeDomain("northgate")).toBe(false);
    expect(looksLikeDomain("not a domain")).toBe(false);
  });
});

describe("error words", () => {
  it("uses plain sentences", () => {
    expect(privacyErrorText("export_limit", "x")).toMatch(/three exports/);
    expect(privacyErrorText("other", "keep me")).toBe("keep me");
    expect(googleErrorText("account_exists_unverified", "x")).toMatch(/Sign in with your password/);
    expect(googleErrorText("google_in_use", "x")).toMatch(/another account/);
    expect(googleErrorText("unknown", "fallback")).toBe("fallback");
  });
});

describe("wallet helpers", () => {
  it("spots Apple devices", () => {
    expect(isAppleDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isAppleDevice("Mozilla/5.0 (Linux; Android 14)")).toBe(false);
  });
  it("accepts only Google's save address", () => {
    expect(isGoogleSaveUrl("https://pay.google.com/gp/v/save/abc.def")).toBe(true);
    expect(isGoogleSaveUrl("https://evil.example/gp/v/save/abc")).toBe(false);
    expect(isGoogleSaveUrl("http://pay.google.com/gp/v/save/abc")).toBe(false);
  });
});

describe("decodeToken", () => {
  it("restores colons that a route parameter percent-encoded", () => {
    expect(decodeToken("abc%3A1xV6Hn%3Asig")).toBe("abc:1xV6Hn:sig");
    expect(decodeToken("abc:1xV6Hn:sig")).toBe("abc:1xV6Hn:sig");
    expect(decodeToken("100%")).toBe("100%");
  });
});
