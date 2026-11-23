import { describe, expect, it } from "vitest";
import { initials } from "./design";

describe("initials", () => {
  it("takes the first letters of the first two words", () => {
    expect(initials("Sara Al Thani")).toBe("SA");
    expect(initials("  omar  ")).toBe("O");
  });
  it("falls back to a question mark", () => {
    expect(initials("")).toBe("?");
  });
});
