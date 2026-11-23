import { describe, expect, it } from "vitest";
import { bannerClass } from "./Announcements";

describe("announcement banner style", () => {
  it("maps severity to the notice style", () => {
    expect(bannerClass("info")).toBe("notice");
    expect(bannerClass("warning")).toBe("notice warn");
    expect(bannerClass("critical")).toBe("notice bad");
  });
});
