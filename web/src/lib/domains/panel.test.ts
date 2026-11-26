import { describe, expect, it } from "vitest";
import type { CustomDomainInfo } from "@/lib/types";
import { daysLeft, domainProblem, needsApexHelp, nextStep, reasonKey, recordRows, statusInfo, tidyDomain } from "./panel";

const info = (over: Partial<CustomDomainInfo> = {}): CustomDomainInfo => ({
  domain: "cards.northgate.com", status: "pending", serving: false, verified_at: null, last_checked_at: null, last_error: null,
  last_error_message: null, expires_at: null, grace_ends_at: null, url: "https://cards.northgate.com/",
  records: {
    txt: { type: "TXT", name: "_bench-verify.cards.northgate.com", value: "bench-verify=abc" },
    cname: { type: "CNAME", name: "cards.northgate.com", value: "app.bench.qa" },
    a: [], apex: false,
  },
  ...over,
});

describe("status", () => {
  it("has a label and tone for every status", () => {
    for (const s of ["pending", "verified", "failed", "expired", "dns_broken"] as const) expect(statusInfo(s).label).toMatch(/^brand\.domStatus/);
    expect(statusInfo("verified").tone).toBe("ok");
    expect(statusInfo("dns_broken").tone).toBe("bad");
    expect(statusInfo("pending").tone).toBe("warn");
    expect(statusInfo("expired").tone).toBe("muted");
  });
  it("maps every check failure to a plain sentence, unknown ones to the DNS one", () => {
    expect(reasonKey(null)).toBeNull();
    for (const c of ["txt_missing", "txt_mismatch", "cname_missing", "cname_wrong", "dns_error", "domain_taken", "dns_released"]) expect(reasonKey(c)).toMatch(/^brand\.domErr/);
    expect(reasonKey("something_new")).toBe("brand.domErrDns");
  });
});

describe("records to add", () => {
  it("shows the TXT proof and the CNAME for a subdomain", () => {
    const rows = recordRows(info());
    expect(rows.map((r) => r.id)).toEqual(["txt", "cname"]);
    expect(rows[0].record.name).toBe("_bench-verify.cards.northgate.com");
    expect(rows[1].record.value).toBe("app.bench.qa");
  });
  it("shows A records instead of the CNAME for a bare domain when the server has addresses", () => {
    const i = info({ domain: "northgate.com", records: { ...info().records, apex: true, a: [{ type: "A", name: "northgate.com", value: "203.0.113.10" }] } });
    expect(recordRows(i).map((r) => r.id)).toEqual(["txt", "a"]);
    expect(needsApexHelp(i)).toBe(true);
  });
  it("keeps the CNAME for a bare domain when no addresses are offered", () => {
    const i = info({ domain: "northgate.com", records: { ...info().records, apex: true } });
    expect(recordRows(i).map((r) => r.id)).toEqual(["txt", "cname"]);
  });
});

describe("next step", () => {
  it("follows the status", () => {
    expect(nextStep(info())).toBe("add_records");
    expect(nextStep(info({ status: "failed", last_error: "txt_missing" }))).toBe("fix");
    expect(nextStep(info({ status: "failed", last_error: "dns_error" }))).toBe("wait");
    expect(nextStep(info({ status: "verified" }))).toBe("done");
    expect(nextStep(info({ status: "dns_broken" }))).toBe("repair");
    expect(nextStep(info({ status: "expired" }))).toBe("retry");
  });
});

describe("days left", () => {
  it("counts whole days, never below zero", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    expect(daysLeft("2026-12-02T12:00:00Z", now)).toBe(7);
    expect(daysLeft("2026-11-25T13:00:00Z", now)).toBe(1);
    expect(daysLeft("2026-11-20T00:00:00Z", now)).toBe(0);
    expect(daysLeft(null, now)).toBe(0);
    expect(daysLeft("nonsense", now)).toBe(0);
  });
});

describe("domain input", () => {
  it("catches the obvious mistakes", () => {
    expect(domainProblem("")).toBe("brand.domProbEmpty");
    expect(domainProblem("https://cards.acme.com")).toBe("brand.domProbUrl");
    expect(domainProblem("cards.acme.com/x")).toBe("brand.domProbUrl");
    expect(domainProblem("*.acme.com")).toBe("brand.domProbWildcard");
    expect(domainProblem("10.0.0.1")).toBe("brand.domProbIp");
    expect(domainProblem("cards.acme.com:8080")).toBe("brand.domProbPort");
    expect(domainProblem("localhost")).toBe("brand.domProbDot");
    expect(domainProblem("cards.acme.com")).toBeNull();
    expect(domainProblem(" Cards.Acme.com. ")).toBeNull();
  });
  it("tidies a pasted address", () => {
    expect(tidyDomain("  HTTPS://Cards.Acme.com/path?x=1 ")).toBe("cards.acme.com");
    expect(tidyDomain("cards.acme.com.")).toBe("cards.acme.com");
  });
});
