import { describe, expect, it } from "vitest";
import { EMPTY_CART, MAX_LINES, MAX_QTY, addProduct, orderItems, parseCart, removeLine, setQty, toMinor, totals, type Cart } from "./cart";

const p = (id: string, price: string | number = "12.50", currency = "QAR") => ({ id, title: `P${id}`, price, currency, image_url: null });

describe("money", () => {
  it("turns a price into whole minor units without float noise", () => {
    expect(toMinor("12.50")).toBe(1250);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMinor("19.99")).toBe(1999);
    expect(toMinor("abc")).toBeNull();
    expect(toMinor(-1)).toBeNull();
    expect(toMinor(null)).toBeNull();
  });
});

describe("the basket", () => {
  it("adds a product, then raises its quantity", () => {
    let c: Cart = addProduct(EMPTY_CART, p("a")).cart;
    c = addProduct(c, p("a")).cart;
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0].qty).toBe(2);
    expect(totals(c)).toEqual({ count: 2, minor: 2500, currency: "QAR" });
  });
  it("keeps one currency per basket", () => {
    const c = addProduct(EMPTY_CART, p("a")).cart;
    const r = addProduct(c, p("b", "5", "USD"));
    expect(r.problem).toBe("currency");
    expect(r.cart).toBe(c);
  });
  it("stops at the line limit and at the quantity limit", () => {
    let c: Cart = EMPTY_CART;
    for (let i = 0; i < MAX_LINES; i++) c = addProduct(c, p(String(i))).cart;
    expect(addProduct(c, p("extra")).problem).toBe("lines");
    const one = setQty(addProduct(EMPTY_CART, p("a")).cart, "a", 500);
    expect(one.lines[0].qty).toBe(MAX_QTY);
  });
  it("ignores a product without a usable price", () => {
    const r = addProduct(EMPTY_CART, p("a", "free"));
    expect(r.cart.lines).toHaveLength(0);
  });
  it("removes a line when its quantity reaches zero", () => {
    const c = addProduct(EMPTY_CART, p("a")).cart;
    expect(setQty(c, "a", 0).lines).toHaveLength(0);
    expect(removeLine(c, "a").lines).toHaveLength(0);
    expect(setQty(c, "a", 3).lines[0].qty).toBe(3);
  });
  it("sends ids and quantities only", () => {
    const c = setQty(addProduct(EMPTY_CART, p("a")).cart, "a", 3);
    expect(orderItems(c)).toEqual([{ product_id: "a", qty: 3 }]);
  });
});

describe("a saved basket", () => {
  it("reads what was saved and drops anything damaged", () => {
    const good = { id: "a", title: "A", minor: 100, currency: "QAR", qty: 2, image_url: null };
    const raw = JSON.stringify({ lines: [good, { id: 5 }, { ...good, id: "b", qty: 0 }, { ...good, id: "c", minor: -1 }, { ...good, id: "d", qty: 1000 }] });
    const c = parseCart(raw);
    expect(c.lines.map((l) => l.id)).toEqual(["a", "d"]);
    expect(c.lines[1].qty).toBe(MAX_QTY);
  });
  it("answers an empty basket for nothing, for broken text and for the wrong shape", () => {
    expect(parseCart(null)).toEqual(EMPTY_CART);
    expect(parseCart("{not json")).toEqual(EMPTY_CART);
    expect(parseCart(JSON.stringify({ lines: "x" }))).toEqual(EMPTY_CART);
  });
});
