import { describe, expect, it } from "vitest";
import { cardAllowance, cardListName, defaultFirst, moveId } from "./card-order";

type C = { id: string; is_default?: boolean };

describe("several cards", () => {
  it("puts the default card first and keeps the others in order", () => {
    const list: C[] = [{ id: "a" }, { id: "b", is_default: true }, { id: "c" }];
    expect(defaultFirst(list).map((c) => c.id)).toEqual(["b", "a", "c"]);
    expect(defaultFirst<C>([{ id: "a", is_default: true }, { id: "b" }]).map((c) => c.id)).toEqual(["a", "b"]);
    expect(defaultFirst<C>([{ id: "a" }, { id: "b" }]).map((c) => c.id)).toEqual(["a", "b"]);
    expect(defaultFirst<C>([])).toEqual([]);
  });

  it("moves a card one place and stops at the ends", () => {
    expect(moveId(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveId(["a", "b"], "zzz", 1)).toEqual(["a", "b"]);
  });

  it("names a card by its label and name", () => {
    expect(cardListName({ label: "Work", name: "Ann" }, "Untitled")).toBe("Work - Ann");
    expect(cardListName({ label: "", name: "Ann" }, "Untitled")).toBe("Ann");
    expect(cardListName({ label: "Work", name: "" }, "Untitled")).toBe("Work");
    expect(cardListName({ name: "  " }, "Untitled")).toBe("Untitled");
  });

  it("knows when the plan has room for one more", () => {
    expect(cardAllowance(1, 5)).toEqual({ used: 1, max: 5, canAdd: true });
    expect(cardAllowance(5, 5).canAdd).toBe(false);
    expect(cardAllowance(9, undefined).canAdd).toBe(true);
  });
});
