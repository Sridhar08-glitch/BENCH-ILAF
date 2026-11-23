import { describe, expect, it } from "vitest";
import { CARD_CHIPS, CARD_PAGE_SIZE, NO_CARD_FILTERS, cardPages, cardRange, cardTagWord, cardsQuery, chipText } from "./cards";

describe("cardsQuery", () => {
  it("leaves empty filters out and counts the offset from the page", () => {
    expect(cardsQuery(NO_CARD_FILTERS)).toEqual({ limit: String(CARD_PAGE_SIZE), offset: "0" });
    expect(cardsQuery({ q: "  ann ", status: "reported", page: 3 })).toEqual({ limit: String(CARD_PAGE_SIZE), offset: String(2 * CARD_PAGE_SIZE), q: "ann", status: "reported" });
    expect(cardsQuery({ q: "", status: "", page: 0 }).offset).toBe("0");
  });
});

describe("chips", () => {
  const counts = { all: 9, active: 5, reported: 2, suspended: 1, draft: 3 };
  it("show the count behind each status", () => {
    expect(CARD_CHIPS.map((c) => chipText(c, counts))).toEqual(["All (9)", "Active (5)", "Reported (2)", "Suspended (1)", "Draft (3)"]);
    expect(chipText(CARD_CHIPS[2], undefined)).toBe("Reported");
  });
});

describe("range and pages", () => {
  it("words the range", () => {
    expect(cardRange(0, 20, 45)).toBe("1-20 of 45");
    expect(cardRange(40, 5, 45)).toBe("41-45 of 45");
    expect(cardRange(0, 0, 0)).toBe("0 cards");
    expect(cardPages(0)).toBe(1);
    expect(cardPages(41)).toBe(3);
  });
});

describe("cardTagWord", () => {
  it("says what a card is", () => {
    expect(cardTagWord("published", false, 0)).toEqual({ text: "Active", tone: "ok" });
    expect(cardTagWord("published", false, 2)).toEqual({ text: "Reported (2)", tone: "warn" });
    expect(cardTagWord("suspended", true, 1)).toEqual({ text: "Suspended", tone: "bad" });
    expect(cardTagWord("suspended", false, 0).text).toBe("Suspended by the company");
    expect(cardTagWord("draft", false, 0)).toEqual({ text: "Draft", tone: "warn" });
  });
});
