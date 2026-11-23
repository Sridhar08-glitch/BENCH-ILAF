import { describe, expect, it } from "vitest";
import { wordmarkParts } from "./Logo";

describe("wordmarkParts", () => {
  it("splits BENCH into the ink part and the orange tail", () => {
    expect(wordmarkParts("BENCH")).toEqual(["BEN", "CH"]);
  });
  it("copes with other and very short names", () => {
    expect(wordmarkParts("Desk")).toEqual(["De", "sk"]);
    expect(wordmarkParts("ab")).toEqual(["ab", ""]);
  });
});
