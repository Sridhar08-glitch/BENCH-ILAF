import { describe, expect, it } from "vitest";
import { ANNOUNCE_KEY, NO_BILLING_FILTERS, announceHref, billingFilterQuery, exportQuery, seatPercent, seatsNearlyFull, storeAnnounceSelection, togglePage } from "./companies";

describe("seats", () => {
  it("warns from 90 percent up", () => {
    expect(seatsNearlyFull(89, 100)).toBe(false);
    expect(seatsNearlyFull(90, 100)).toBe(true);
    expect(seatsNearlyFull(5, 5)).toBe(true);
    expect(seatsNearlyFull(4, 5)).toBe(false);
    expect(seatsNearlyFull(3, 0)).toBe(false);
  });
  it("gives a whole percent", () => {
    expect(seatPercent(412, 500)).toBe(82);
    expect(seatPercent(1, 0)).toBe(0);
  });
});

describe("the hand-over to announcements", () => {
  it("builds the link and stores the ids under the agreed key", () => {
    expect(announceHref(["a", "b"])).toBe("/staff/announcements?companies=a,b");
    const kept: Record<string, string> = {};
    storeAnnounceSelection(["a", "b"], { setItem: (k, v) => { kept[k] = v; } });
    expect(ANNOUNCE_KEY).toBe("staff-announce-companies");
    expect(JSON.parse(kept[ANNOUNCE_KEY])).toEqual(["a", "b"]);
  });
  it("does not throw where storage is blocked", () => {
    expect(() => storeAnnounceSelection(["a"], { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });
});

describe("exportQuery", () => {
  const filters = { q: "pol", plan: "", status: "active", sort: "name" };
  it("sends the picked ids, or else the list filters", () => {
    expect(exportQuery(["x", "y"], filters)).toEqual({ ids: "x,y" });
    expect(exportQuery([], filters)).toEqual({ q: "pol", status: "active", sort: "name" });
  });
});

describe("billing filters", () => {
  it("sends only the switches that are on, and the export carries them", () => {
    expect(billingFilterQuery(NO_BILLING_FILTERS)).toEqual({});
    expect(billingFilterQuery({ autoRenewOff: true, paymentFailed: true, grandfathered: false, enterprise: true })).toEqual({ auto_renew: "off", payment_failed: "1", enterprise: "1" });
    const q = exportQuery([], { q: "", plan: "company", status: "", sort: "name", ...billingFilterQuery({ ...NO_BILLING_FILTERS, grandfathered: true }) });
    expect(q).toEqual({ plan: "company", sort: "name", grandfathered: "1" });
  });
});

describe("togglePage", () => {
  it("picks the whole page, then clears it, keeping picks from other pages", () => {
    expect(togglePage(["z"], ["a", "b"])).toEqual(["z", "a", "b"]);
    expect(togglePage(["z", "a"], ["a", "b"])).toEqual(["z", "a", "b"]);
    expect(togglePage(["z", "a", "b"], ["a", "b"])).toEqual(["z"]);
    expect(togglePage([], [])).toEqual([]);
  });
});
