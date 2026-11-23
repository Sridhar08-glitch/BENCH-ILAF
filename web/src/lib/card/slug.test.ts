import { describe, expect, it } from "vitest";
import { isValidSlug, normaliseSlug } from "./slug";

describe("slug normaliser", () => {
  it("lower-cases and joins words with dashes", () => {
    expect(normaliseSlug("Jasir Vadakkedath")).toBe("jasir-vadakkedath");
  });
  it("removes odd characters and repeated dashes", () => {
    expect(normaliseSlug("  --Hello___World!!  ")).toBe("hello-world");
  });
  it("strips a pasted address", () => {
    expect(normaliseSlug("https://cards.example/c/jasir")).toBe("jasir");
    expect(normaliseSlug("cards.example/jasir")).toBe("jasir");
  });
  it("cuts to the maximum length without a trailing dash", () => {
    const s = normaliseSlug("a".repeat(30) + " " + "b".repeat(30));
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith("-")).toBe(false);
  });
  it("validates", () => {
    expect(isValidSlug("jasir")).toBe(true);
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("-abc")).toBe(false);
    expect(isValidSlug("a--b")).toBe(false);
    expect(isValidSlug("ABC")).toBe(false);
  });
});
