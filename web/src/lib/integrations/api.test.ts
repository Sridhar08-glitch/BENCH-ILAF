import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createI18n } from "@/lib/i18n";
import { CATALOGUES } from "@/lib/i18n/messages";
import { ApiError } from "@/lib/api";
import { CODE_TEXT, codeText, errorText } from "./api";

const ERRORS = path.join(__dirname, "..", "..", "..", "..", "backend", "crm", "errors.py");

describe("CRM error codes are shown by code, in both languages", () => {
  it("every code the backend can store has a text", () => {
    if (!fs.existsSync(ERRORS)) return;
    const codes = [...fs.readFileSync(ERRORS, "utf8").matchAll(/code = "(crm_[a-z_]+)"/g)].map((m) => m[1]).filter((c) => c !== "crm_error");
    expect(codes.length).toBeGreaterThan(5);
    for (const code of codes) expect(CODE_TEXT[code], code).toBeDefined();
  });

  it("gives Arabic text for each code and falls back for unknown codes", () => {
    const ar = createI18n("ar", "latn", CATALOGUES.ar);
    const en = createI18n("en", "latn", CATALOGUES.en);
    for (const code of Object.keys(CODE_TEXT)) {
      expect(codeText(code, ar.t, "x")).toMatch(/[؀-ۿ]/);
      expect(codeText(code, en.t, "x")).not.toBe("x");
    }
    expect(codeText("something_else", en.t, "fallback")).toBe("fallback");
    expect(errorText(new ApiError(403, "crm_forbidden", "server words"), ar.t)).toMatch(/[؀-ۿ]/);
    expect(errorText(new ApiError(400, "validation_error", "server words"), en.t)).toBe("server words");
  });
});
