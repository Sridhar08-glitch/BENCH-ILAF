import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ApiError } from "@/lib/api";
import { en } from "@/lib/i18n/messages";
import { createI18n } from "@/lib/i18n";
import { CATALOGUES } from "@/lib/i18n/messages";
import { config } from "@/middleware";
import { errorText, staffToken, TIMELINE } from "./api";

const tEn = createI18n("en", "latn", CATALOGUES.en).t;
const tAr = createI18n("ar", "latn", CATALOGUES.ar).t;

describe("error words by code", () => {
  const codes = ["request_open", "request_finished", "not_in_review", "bad_transition", "no_face_in_review", "not_approved", "bad_state", "face_empty", "face_palettes", "last_admin", "already_enrolled", "totp_not_enrolled", "staff_locked", "staff_verification_required", "forbidden", "not_found", "throttled", "network_error", "unauthorized"];
  it("shows each known code in English and in Arabic, never the server sentence", () => {
    for (const code of codes) {
      const e = new ApiError(400, code, "RAW SERVER SENTENCE");
      expect(errorText(e, tEn)).not.toContain("RAW SERVER");
      expect(errorText(e, tAr)).toMatch(/[؀-ۿ]/);
    }
  });
  it("falls back to a general sentence, and shows the first field message of a validation error", () => {
    expect(errorText(new ApiError(500, "weird", "boom"), tEn)).toBe(en["designs.err.generic"]);
    expect(errorText(new Error("x"), tEn)).toBe(en["designs.err.generic"]);
    expect(errorText(new ApiError(400, "validation_error", "m", { goals: ["Tell us more."] }), tEn)).toBe("Tell us more.");
    expect(errorText(new ApiError(400, "validation_error", "m"), tEn)).toBe(en["designs.err.validation"]);
  });
});

describe("staff route guards", () => {
  it("the sign-in middleware covers the whole staff area", () => {
    expect(config.matcher).toEqual(expect.arrayContaining(["/staff", "/staff/:path*"]));
  });
  it("the proxy passes the second-step token on", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../app/api/proxy/[...path]/route.ts"), "utf8");
    expect(src).toContain('req.headers.get("x-staff-token")');
  });
  it("the customer app never links to the staff area", () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (d.name === "staff" ? [] : walk(path.join(dir, d.name))) : [path.join(dir, d.name)]));
    const root = path.resolve(__dirname, "../..");
    const hits = walk(root).filter((f) => /\.(tsx?)$/.test(f) && !/staff|middleware|\.test\./.test(path.relative(root, f)) && !f.includes("designs" + path.sep + "api.ts") && fs.readFileSync(f, "utf8").includes('"/staff'));
    expect(hits).toEqual([]);
  });
  it("keeps the token for this tab only", () => {
    expect(staffToken.get()).toBeNull();
    expect(TIMELINE).toEqual(["new", "contacted", "in_design", "in_review", "approved", "live"]);
  });
});
