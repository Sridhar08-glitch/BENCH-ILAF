import { describe, expect, it } from "vitest";
import { cardStatusWord, localeOf, pageDataOf } from "./card-data";
import type { CardRow } from "./api";

const card = {
  id: "1", workspace_id: "w", workspace_name: "Acme", name: "Alice", title: "Designer", company: "Studio", address: "", status: "published", staff_hold: false,
  public_code: "abc", public_url: "https://x.test/c/abc", slug: null, photo_url: null, cover_url: null, save_contact: true, language: "auto", design: { face: 1 },
  items: [{ kind: "phone", value: "1", label: "", on: true }, { kind: "mail", value: "a@b.c", label: "", on: false }], owner: null, stats: { views: 0, scans: 0, saves: 0, leads: 0 }, created_at: "",
} as unknown as CardRow;

describe("staff card thumbnails", () => {
  it("draws only the buttons that are on", () => {
    expect(pageDataOf(card).items.map((i) => i.kind)).toEqual(["phone"]);
    expect(pageDataOf(card).publicUrl).toBe("https://x.test/c/abc");
  });
  it("uses Arabic words only for an Arabic card", () => {
    expect(localeOf("ar")).toBe("ar");
    expect(localeOf("auto")).toBe("en");
    expect(pageDataOf({ ...card, language: "ar" }).locale).toBe("ar");
  });
  it("says who suspended a card", () => {
    expect(cardStatusWord({ status: "suspended", staff_hold: true })).toBe("Suspended by staff");
    expect(cardStatusWord({ status: "suspended", staff_hold: false })).toBe("Suspended by the company");
    expect(cardStatusWord({ status: "draft", staff_hold: false })).toBe("Draft");
  });
});
