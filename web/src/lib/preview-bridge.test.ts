// @vitest-environment node
import { describe, expect, it } from "vitest";
import { previewHref } from "./preview-bridge";

describe("previewHref", () => {
  it("points at the preview page of a card or of the brand", () => {
    expect(previewHref("abc-123")).toBe("/app/preview/abc-123");
    expect(previewHref("brand")).toBe("/app/preview/brand");
  });
});
