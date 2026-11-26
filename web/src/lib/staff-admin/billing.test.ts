import { describe, expect, it } from "vitest";
import { cleanQuery, daysWord, domainTone, freeWeekWords, funnelRows, qar, qarShort, renewalTone, renewalWord, revenuePoints, sharingSentence, stripeLink } from "./billing";

describe("money", () => {
  it("is always QAR, from minor units", () => {
    expect(qar(12500)).toBe("125.00 QAR");
    expect(qar(null)).toBe("-");
    expect(qarShort(2730000)).toBe("27,300 QAR");
    expect(qar(1)).not.toMatch(/AED/);
  });
});

describe("renewal words", () => {
  it("names the three states", () => {
    expect(renewalWord("auto")).toBe("Auto-renew on");
    expect(renewalWord("manual")).toBe("Auto-renew off");
    expect(renewalWord("cancels")).toBe("Cancels at period end");
    expect(renewalWord("none")).toBe("-");
    expect(renewalTone("auto")).toBe("ok");
    expect(renewalTone("cancels")).toBe("warn");
    expect(renewalTone("none")).toBe("");
  });
});

describe("free week", () => {
  it("says when it ends, or that it ended", () => {
    expect(freeWeekWords({ state: "free_week", ends_at: "2026-12-03T10:00:00Z" })).toEqual({ text: "Free week, ends 3 Dec 2026", tone: "warn" });
    expect(freeWeekWords({ state: "free_week_ended", ends_at: "2026-11-20T10:00:00Z" }).text).toBe("Free week ended");
    expect(freeWeekWords({ state: "paid", ends_at: null }).tone).toBe("ok");
    expect(freeWeekWords({ state: "none", ends_at: null }).text).toBe("No card published yet");
  });
});

describe("Stripe links", () => {
  it("only exist for a real id", () => {
    expect(stripeLink("customer", "cus_123")).toBe("https://dashboard.stripe.com/customers/cus_123");
    expect(stripeLink("subscription", "sub_9")).toBe("https://dashboard.stripe.com/subscriptions/sub_9");
    expect(stripeLink("invoice", "in_1")).toBe("https://dashboard.stripe.com/invoices/in_1");
    for (const none of ["", "  ", null, undefined, "a/b", "x y", "../x"]) expect(stripeLink("customer", none as string | null | undefined), String(none)).toBeNull();
  });
});

describe("contact sharing sentence", () => {
  it("is counts only", () => {
    expect(sharingSentence({ employees: 8, sharing: 3 })).toBe("3 of 8 employees share their new contacts with the company");
    expect(sharingSentence({ employees: 1, sharing: 0 })).toBe("0 of 1 employee share their new contacts with the company");
    expect(sharingSentence({ employees: 0, sharing: 0 })).toBe("No employees yet.");
  });
});

describe("domain words", () => {
  it("has a tone for each status", () => {
    expect(domainTone("verified")).toBe("ok");
    expect(domainTone("pending")).toBe("warn");
    expect(domainTone("dns_broken")).toBe("bad");
    expect(domainTone(null)).toBe("");
  });
});

describe("funnel", () => {
  it("gives each step as a share of the sign-ups", () => {
    const rows = funnelRows({ days: 7, signed_up: 40, created_card: 20, published: 10, still_live: 6, ended_unpaid: 3, converted: 1 });
    expect(rows.map((r) => r.key)).toEqual(["signed_up", "created_card", "published", "still_live", "ended_unpaid", "converted"]);
    expect(rows.map((r) => r.percent)).toEqual([100, 50, 25, 15, 8, 3]);
  });
  it("does not divide by zero", () => {
    expect(funnelRows({ days: 30, signed_up: 0, created_card: 0, published: 0, still_live: 0, ended_unpaid: 0, converted: 0 }).every((r) => r.percent === 0)).toBe(true);
  });
});

describe("revenue", () => {
  it("is drawn in whole QAR", () => {
    expect(revenuePoints([{ month: "2026-11", amount_minor: 12550 }, { month: "2026-12", amount_minor: 0 }])).toEqual([{ label: "26-11", value: 126 }, { label: "26-12", value: 0 }]);
  });
});

describe("small helpers", () => {
  it("words the days of a renewal", () => {
    expect(daysWord(3)).toBe("in 3 days");
    expect(daysWord(1)).toBe("in 1 day");
    expect(daysWord(0)).toBe("today");
    expect(daysWord(-2)).toBe("2 days late (grace days)");
  });
  it("drops empty filters", () => {
    expect(cleanQuery({ a: "x", b: "", c: undefined })).toEqual({ a: "x" });
  });
});
