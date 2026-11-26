import { describe, expect, it } from "vitest";
import type { HoursDay, PublicSection } from "@/lib/public-api";
import {
  addableKinds, categoryOf, countdownParts, dayName, defaultDays, formatPrice, groupByCategory, groupDays, icsFor, listingFacts, localClock, minutesOf,
  openState, orderSections, pad2, productsOf, safeHttps, zoneOffset,
} from "./helpers";

const week = (overrides: Partial<Record<number, Partial<HoursDay>>> = {}): HoursDay[] =>
  defaultDays().map((d) => ({ ...d, ...(overrides[d.d] ?? {}) }));

describe("section order", () => {
  it("sorts by the owner's order and drops what cannot be drawn", () => {
    const list = [
      { id: "b", kind: "hours", order: 2, data: { title: "", timezone: "UTC", days: [], note: "" } },
      { id: "a", kind: "video", order: 1, data: { title: "" } },
      { id: "x", kind: "wizard", order: 0, data: {} },
      { id: "c", kind: "map", order: 1, data: null },
    ] as unknown as PublicSection[];
    expect(orderSections(list).map((s) => s.id)).toEqual(["a", "b"]);
    expect(orderSections(null)).toEqual([]);
    expect(orderSections(undefined)).toEqual([]);
  });

  it("breaks an order tie by the fixed kind order", () => {
    const list = [
      { id: "m", kind: "map", order: 0, data: { title: "", address: "", maps_url: "", directions_note: "" } },
      { id: "v", kind: "video", order: 0, data: { title: "" } },
    ] as PublicSection[];
    expect(orderSections(list).map((s) => s.id)).toEqual(["v", "m"]);
  });

  it("knows which kinds a card may still add", () => {
    expect(addableKinds([])).toHaveLength(8);
    expect(addableKinds([{ kind: "video" }, { kind: "products" }])).not.toContain("video");
    expect(addableKinds([{ kind: "products" }, { kind: "products" }])).toContain("products");
    expect(addableKinds([{ kind: "products" }, { kind: "products" }, { kind: "products" }])).not.toContain("products");
  });
});

describe("products helpers", () => {
  const p = (id: string, meta: Record<string, unknown> = {}) => ({ id, title: id, description: "", price: "1", currency: "QAR", image_url: null, badge: "", meta, stock: null });

  it("reads the expanded list under either name and skips broken rows", () => {
    expect(productsOf({ items: [p("a")] }).map((x) => x.id)).toEqual(["a"]);
    expect(productsOf({ products: [p("b"), null as unknown as ReturnType<typeof p>] }).map((x) => x.id)).toEqual(["b"]);
    expect(productsOf(null)).toEqual([]);
  });

  it("formats prices with the currency code and no cents for whole amounts", () => {
    expect(formatPrice("320.00", "QAR", "en")).toBe("QAR 320");
    expect(formatPrice(12.5, "AED", "en")).toBe("AED 12.50");
    expect(formatPrice("nope", "QAR", "en")).toBe("");
    expect(formatPrice("1450000", "QAR", "en")).toBe("QAR 1,450,000");
    expect(formatPrice("5", "xx", "en")).toBe("QAR 5");
  });

  it("groups a menu by category in first-seen order", () => {
    const groups = groupByCategory([p("1", { category: "Coffee" }), p("2"), p("3", { category: "Breakfast" }), p("4", { category: "Coffee" })]);
    expect(groups.map((g) => g.category)).toEqual(["Coffee", "", "Breakfast"]);
    expect(groups[0].items.map((x) => x.id)).toEqual(["1", "4"]);
    expect(categoryOf({ category: "  Tea " })).toBe("Tea");
    expect(categoryOf({ category: 3 })).toBe("");
  });

  it("reads listing facts as text", () => {
    expect(listingFacts({ beds: 3, baths: "2", size: "240 m²" })).toEqual({ beds: "3", baths: "2", size: "240 m²" });
    expect(listingFacts({ beds: "" })).toEqual({ beds: "", baths: "", size: "" });
    expect(listingFacts(undefined)).toEqual({ beds: "", baths: "", size: "" });
  });
});

describe("opening hours", () => {
  it("parses times", () => {
    expect(minutesOf("09:30")).toBe(570);
    expect(minutesOf("24:00")).toBe(1440);
    expect(minutesOf("24:30")).toBeNull();
    expect(minutesOf("9")).toBeNull();
    expect(minutesOf(undefined)).toBeNull();
  });

  it("reads the local day and time in the place's zone", () => {
    // 2026-11-24 is a Tuesday. 22:30 UTC is 01:30 on Wednesday in Doha and 14:30 on Tuesday in Los Angeles.
    const now = new Date("2026-11-24T22:30:00Z");
    expect(localClock("Asia/Qatar", now)).toEqual({ day: 2, minutes: 90, timezone: "Asia/Qatar" });
    expect(localClock("America/Los_Angeles", now)).toEqual({ day: 1, minutes: 14 * 60 + 30, timezone: "America/Los_Angeles" });
    expect(localClock("Not/AZone", now).timezone).toBe("UTC");
    expect(localClock("UTC", new Date("2026-11-29T00:10:00Z")).day).toBe(6);
  });

  it("says open or closed in the place's own zone, not the server's", () => {
    const days = week();
    // 07:00 UTC Tuesday = 10:00 in Doha (open), 02:00 in Los Angeles... wait, 23:00 Monday there (closed).
    const now = new Date("2026-11-24T07:00:00Z");
    expect(openState(days, "Asia/Qatar", now)).toMatchObject({ open: true, closesAt: "18:00" });
    expect(openState(days, "America/Los_Angeles", now)).toMatchObject({ open: false, opensAt: null });
    // 05:00 UTC Tuesday = 08:00 in Doha: opens later today.
    expect(openState(days, "Asia/Qatar", new Date("2026-11-24T05:00:00Z"))).toMatchObject({ open: false, opensAt: "09:00" });
    // Saturday is closed.
    expect(openState(days, "UTC", new Date("2026-11-28T12:00:00Z"))).toMatchObject({ open: false, opensAt: null, closesAt: null });
  });

  it("handles a night that runs past midnight", () => {
    const days = week({ 4: { open: "20:00", close: "02:00", closed: false } });
    // Friday 23:00 UTC: open. Saturday 01:00 UTC: still open from Friday. Saturday 03:00: closed.
    expect(openState(days, "UTC", new Date("2026-11-27T23:00:00Z")).open).toBe(true);
    expect(openState(days, "UTC", new Date("2026-11-28T01:00:00Z"))).toMatchObject({ open: true, closesAt: "02:00" });
    expect(openState(days, "UTC", new Date("2026-11-28T03:00:00Z")).open).toBe(false);
  });

  it("groups runs of days with the same hours", () => {
    const rows = groupDays(week({ 5: { closed: false, open: "10:00", close: "14:00" } }));
    expect(rows).toEqual([
      { from: 0, to: 4, open: "09:00", close: "18:00", closed: false },
      { from: 5, to: 5, open: "10:00", close: "14:00", closed: false },
      { from: 6, to: 6, open: "09:00", close: "18:00", closed: true },
    ]);
    expect(groupDays([])).toEqual([{ from: 0, to: 6, open: "", close: "", closed: true }]);
  });

  it("names days from Monday in each language", () => {
    expect(dayName(0, "en")).toBe("Monday");
    expect(dayName(6, "en", "short")).toBe("Sun");
    expect(dayName(4, "ar")).toBe("الجمعة");
    expect(dayName(7, "en")).toBe("Monday");
  });

  it("reads a zone offset", () => {
    const now = new Date("2026-11-24T07:00:00Z");
    expect(zoneOffset("Asia/Qatar", now)).toBe("+03:00");
    expect(zoneOffset("UTC", now)).toBe("+00:00");
    expect(zoneOffset("Nowhere/Here", now)).toBe("");
  });
});

describe("countdown", () => {
  const start = "2026-12-01T09:00:00Z";

  it("counts days, hours, minutes and seconds to the start", () => {
    expect(countdownParts(start, null, new Date("2026-11-28T06:30:15Z"))).toEqual({ state: "before", days: 3, hours: 2, minutes: 29, seconds: 45 });
    expect(countdownParts(start, null, new Date("2026-12-01T08:59:59Z"))).toEqual({ state: "before", days: 0, hours: 0, minutes: 0, seconds: 1 });
  });

  it("is live between start and end, and for a day when there is no end", () => {
    expect(countdownParts(start, "2026-12-03T17:00:00Z", new Date("2026-12-02T12:00:00Z")).state).toBe("live");
    expect(countdownParts(start, "2026-12-03T17:00:00Z", new Date("2026-12-03T17:00:01Z")).state).toBe("ended");
    expect(countdownParts(start, null, new Date("2026-12-01T20:00:00Z")).state).toBe("live");
    expect(countdownParts(start, null, new Date("2026-12-02T09:00:01Z")).state).toBe("ended");
  });

  it("treats a broken date as ended and pads tiles", () => {
    expect(countdownParts("soon", null, new Date()).state).toBe("ended");
    expect(pad2(7)).toBe("07");
    expect(pad2(-3)).toBe("00");
    expect(pad2(123)).toBe("123");
  });
});

describe("calendar file and links", () => {
  it("writes a calendar entry with the talk as its name", () => {
    const ics = icsFor({ event_name: "Doha Tech Forum", starts_at: "2026-03-14T08:30:00Z", ends_at: "2026-03-14T09:10:00Z", venue: "QNCC", hall: "Hall 2, L1", stand: "", talk_title: "Designing for a bilingual Gulf" }, "https://ilaf.one/c/sara");
    expect(ics).toContain("DTSTART:20260314T083000Z");
    expect(ics).toContain("DTEND:20260314T091000Z");
    expect(ics).toContain("SUMMARY:Designing for a bilingual Gulf");
    expect(ics).toContain("LOCATION:QNCC\\, Hall 2\\, L1");
    expect(ics).toContain("URL:https://ilaf.one/c/sara");
    expect(ics?.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });

  it("gives an hour to an event without an end and refuses a broken start", () => {
    const ics = icsFor({ event_name: "Expo", starts_at: "2026-03-14T08:30:00Z", ends_at: null, venue: "", hall: "", stand: "", talk_title: "" }, "");
    expect(ics).toContain("DTEND:20260314T093000Z");
    expect(ics).toContain("SUMMARY:Expo");
    expect(icsFor({ event_name: "Expo", starts_at: "", ends_at: null, venue: "", hall: "", stand: "", talk_title: "" }, "")).toBeNull();
  });

  it("only links to https addresses", () => {
    expect(safeHttps("https://maps.app.goo.gl/abc")).toBe(true);
    expect(safeHttps("http://example.com")).toBe(false);
    expect(safeHttps("javascript:alert(1)")).toBe(false);
    expect(safeHttps("")).toBe(false);
    expect(safeHttps(null)).toBe(false);
  });
});
