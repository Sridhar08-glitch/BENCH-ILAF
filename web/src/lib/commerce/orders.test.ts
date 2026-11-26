import { describe, expect, it } from "vitest";
import { NO_FILTERS, filterCount, itemsSummary, listQuery, nextBookingStatuses, nextOrderStatuses, orderIsFinal, rangeProblem } from "./orders";
import { BOOKING_STATUS_NAME, METHOD_NAME, ORDER_STATUS_NAME, PAYMENT_NAME } from "./names";
import { bellTotal } from "../leadBell";
import { cleanPrice, cleanStock } from "@/components/editor/content/ProductsForm";

describe("statuses", () => {
  it("lets an order move forward or be cancelled, and nothing after the end", () => {
    expect(nextOrderStatuses("new")).toEqual(["confirmed", "cancelled"]);
    expect(nextOrderStatuses("ready")).toEqual(["delivered", "cancelled"]);
    expect(nextOrderStatuses("delivered")).toEqual([]);
    expect(orderIsFinal("cancelled")).toBe(true);
    expect(orderIsFinal("new")).toBe(false);
  });
  it("follows the booking steps of the API", () => {
    expect(nextBookingStatuses("requested")).toEqual(["confirmed", "cancelled"]);
    expect(nextBookingStatuses("confirmed")).toEqual(["done", "cancelled"]);
    expect(nextBookingStatuses("done")).toEqual([]);
    expect(nextBookingStatuses("cancelled")).toEqual([]);
  });
  it("has a word for every state", () => {
    for (const k of ["new", "confirmed", "ready", "delivered", "cancelled"] as const) expect(ORDER_STATUS_NAME[k]).toMatch(/^commerce\./);
    for (const k of ["unpaid", "paid", "refunded"] as const) expect(PAYMENT_NAME[k]).toMatch(/^commerce\./);
    for (const k of ["cod", "whatsapp", "card_later"] as const) expect(METHOD_NAME[k]).toMatch(/^commerce\./);
    for (const k of ["requested", "confirmed", "done", "cancelled"] as const) expect(BOOKING_STATUS_NAME[k]).toMatch(/^commerce\./);
  });
});

describe("list filters", () => {
  it("counts the filters in use and spots an impossible date range", () => {
    expect(filterCount(NO_FILTERS)).toBe(0);
    expect(filterCount({ ...NO_FILTERS, status: "new", q: "  " })).toBe(1);
    expect(rangeProblem({ from: "2027-02-01", to: "2027-01-01" })).toBe(true);
    expect(rangeProblem({ from: "2027-01-01", to: "2027-02-01" })).toBe(false);
  });
  it("builds the query with the page and only what is set", () => {
    expect(listQuery({ ...NO_FILTERS, status: "new,ready", q: " ali " }, 2, 50)).toBe("status=new%2Cready&q=ali&page=2&page_size=50");
    expect(listQuery(NO_FILTERS, 0, 50)).toBe("page=1&page_size=50");
  });
  it("sums up the items of an order", () => {
    const items = [1, 2, 3, 4].map((n) => ({ product_id: String(n), title: `T${n}`, unit_price: "1.00", currency: "QAR", qty: n }));
    expect(itemsSummary({ items }, 2)).toBe("1 × T1, 2 × T2 +2");
    expect(itemsSummary({ items: items.slice(0, 1) })).toBe("1 × T1");
  });
});

describe("the bell", () => {
  it("counts contacts, orders and bookings together and ignores bad numbers", () => {
    expect(bellTotal({ unread: 2, orders: 3, bookings: 1 })).toBe(6);
    expect(bellTotal({ unread: 2 })).toBe(2);
    expect(bellTotal({ unread: -4, orders: Number.NaN, bookings: 2.9 })).toBe(2);
    expect(bellTotal(undefined)).toBe(0);
  });
});

describe("product fields", () => {
  it("accepts prices with up to two decimals and a comma", () => {
    expect(cleanPrice("12")).toBe("12.00");
    expect(cleanPrice("12,5")).toBe("12.50");
    expect(cleanPrice(" 0.99 ")).toBe("0.99");
    expect(cleanPrice("1.999")).toBeNull();
    expect(cleanPrice("-3")).toBeNull();
    expect(cleanPrice("")).toBeNull();
  });
  it("reads stock: empty is unlimited, junk is refused", () => {
    expect(cleanStock("")).toBeNull();
    expect(cleanStock("0")).toBe(0);
    expect(cleanStock("25")).toBe(25);
    expect(cleanStock("-1")).toBeUndefined();
    expect(cleanStock("2.5")).toBeUndefined();
  });
});
