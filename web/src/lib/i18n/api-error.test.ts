import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { apiErrorText, apiFieldText, apiFirstFieldText, apiReasonText, apiServerText } from "./api-error";
import { createI18n } from "./index";
import { CATALOGUES } from "./messages";

const en = createI18n("en", "latn", CATALOGUES.en);
const ar = createI18n("ar", "latn", CATALOGUES.ar);
const err = (code: string, message: string, fields: Record<string, string[]> = {}, status = 400, retryAfter = 0) => new ApiError(status, code, message, fields, retryAfter);

describe("apiErrorText", () => {
  it("says the text of the code in the screen's language, not the server's sentence", () => {
    const e = err("invalid_credentials", "Email or password is not correct.", {}, 401);
    expect(apiErrorText(e, en.t, undefined, "en")).toBe(CATALOGUES.en["apiError.invalid_credentials"]);
    expect(apiErrorText(e, ar.t, undefined, "ar")).toBe(CATALOGUES.ar["apiError.invalid_credentials"]);
    expect(apiErrorText(e, ar.t, undefined, "ar")).toMatch(/[؀-ۿ]/);
  });

  it("never shows raw English in Arabic, even for a code nobody wrote a text for", () => {
    const e = err("brand_new_code", "Something English the server said");
    expect(apiErrorText(e, ar.t, undefined, "ar")).toBe(CATALOGUES.ar["apiError.generic"]);
    expect(apiErrorText(e, ar.t, "err.generic", "ar")).toBe(CATALOGUES.ar["err.generic"]);
  });

  it("uses the server's English sentence only on an English screen for an unknown code, after the fallback key", () => {
    const e = err("brand_new_code", "Something English the server said");
    expect(apiErrorText(e, en.t, undefined, "en")).toBe("Something English the server said");
    expect(apiErrorText(e, en.t, "err.generic", "en")).toBe(CATALOGUES.en["err.generic"]);
  });

  it("keeps the server's own sentence for shared codes when it is in the screen's language", () => {
    const arabic = err("forbidden", "ليست لديك صلاحية لتنفيذ ذلك.", {}, 403);
    expect(apiErrorText(arabic, ar.t, undefined, "ar")).toBe("ليست لديك صلاحية لتنفيذ ذلك.");
    const english = err("forbidden", "Only the owner can change roles.", {}, 403);
    expect(apiErrorText(english, ar.t, undefined, "ar")).toBe(CATALOGUES.ar["apiError.forbidden"]);
    expect(apiErrorText(english, en.t, undefined, "en")).toBe("Only the owner can change roles.");
    expect(apiErrorText(arabic, en.t, undefined, "en")).toBe(CATALOGUES.en["apiError.forbidden"]);
  });

  it("puts the wait into the throttled text", () => {
    const e = err("throttled", "Too many requests", {}, 429, 12);
    expect(apiErrorText(e, en.t, undefined, "en")).toContain("12");
    expect(apiErrorText(e, ar.t, undefined, "ar")).toMatch(/12|ثوانٍ|ثانية/);
  });

  it("falls back for anything that is not an API error", () => {
    expect(apiErrorText(new TypeError("Failed to fetch"), ar.t, "err.generic", "ar")).toBe(CATALOGUES.ar["err.generic"]);
    expect(apiErrorText("boom", en.t, undefined, "en")).toBe(CATALOGUES.en["apiError.generic"]);
  });
});

describe("field and reason texts", () => {
  it("shows a field message only when it is in the screen's language", () => {
    const e = err("validation_error", "Bad", { url: ["Use https"], name: ["أدخل الاسم"] });
    expect(apiFieldText(e, "url", ar.t, "ar")).toBe(CATALOGUES.ar["apiError.field"]);
    expect(apiFieldText(e, "name", ar.t, "ar")).toBe("أدخل الاسم");
    expect(apiFieldText(e, "url", en.t, "en")).toBe("Use https");
    expect(apiFieldText(e, "none", en.t, "en")).toBeUndefined();
    expect(apiFirstFieldText(e, ar.t, undefined, "ar")).toBe(CATALOGUES.ar["apiError.field"]);
  });

  it("chooses the text of a refused item by its code, then its sentence", () => {
    expect(apiReasonText({ code: "member_suspended", reason: "This team member is suspended." }, ar.t, "err.generic", "ar")).toBe(CATALOGUES.ar["apiError.member_suspended"]);
    expect(apiReasonText({ code: "forbidden", reason: "Only the owner can change roles." }, ar.t, "err.generic", "ar")).toBe(CATALOGUES.ar["err.generic"]);
    expect(apiServerText("Missing email.", en.t, undefined, "en")).toBe("Missing email.");
    expect(apiServerText("Missing email.", ar.t, undefined, "ar")).toBe(CATALOGUES.ar["apiError.generic"]);
    expect(apiServerText("البريد الإلكتروني مفقود.", ar.t, undefined, "ar")).toBe("البريد الإلكتروني مفقود.");
  });
});
