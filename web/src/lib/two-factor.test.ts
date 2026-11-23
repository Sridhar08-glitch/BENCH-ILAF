import { describe, expect, it } from "vitest";
import { cleanCode, cleanRecovery, groupSecret, isSecurityPath, otpauthIsSafe, recoveryFileText } from "./two-factor";
import { isMfaChallenge } from "./security-api";

describe("two-step verification helpers", () => {
  it("keeps the six digits of a pasted code", () => {
    expect(cleanCode("123 456")).toBe("123456");
    expect(cleanCode("12-34-56")).toBe("123456");
    expect(cleanCode("1234567890")).toBe("123456");
    expect(cleanCode("abc")).toBe("");
  });

  it("reads Arabic-Indic and Persian digits", () => {
    expect(cleanCode("١٢٣ ٤٥٦")).toBe("123456");
    expect(cleanCode("۱۲۳۴۵۶")).toBe("123456");
  });

  it("cleans a recovery code", () => {
    expect(cleanRecovery("A1B2C-3D4E5")).toBe("a1b2c3d4e5");
    expect(cleanRecovery(" a1b2c 3d4e5 ")).toBe("a1b2c3d4e5");
  });

  it("writes the recovery codes as a text file", () => {
    expect(recoveryFileText(["a-b", "c-d"], "Note")).toBe("Note\n\na-b\nc-d\n");
  });

  it("groups the secret in fours and only accepts a real otpauth address", () => {
    expect(groupSecret("ABCDEFGHIJKL")).toBe("ABCD EFGH IJKL");
    expect(otpauthIsSafe("otpauth://totp/App:me%40x.com?secret=JBSWY3DPEHPK3PXP&issuer=App")).toBe(true);
    expect(otpauthIsSafe("javascript:alert(1)")).toBe(false);
    expect(otpauthIsSafe("otpauth://hotp/x?secret=ABC&")).toBe(false);
  });

  it("knows which pages stay open when 2-step verification is required", () => {
    expect(isSecurityPath("/app/settings/security")).toBe(true);
    expect(isSecurityPath("/app/settings/devices")).toBe(true);
    expect(isSecurityPath("/app/settings")).toBe(false);
    expect(isSecurityPath("/app/cards")).toBe(false);
    expect(isSecurityPath(null)).toBe(false);
  });

  it("recognises the answer that asks for the second step", () => {
    expect(isMfaChallenge({ mfa_required: true, mfa_token: "x", methods: ["totp"] })).toBe(true);
    expect(isMfaChallenge({ user: {} })).toBe(false);
    expect(isMfaChallenge(null)).toBe(false);
    expect(isMfaChallenge({ mfa_required: true })).toBe(false);
  });
});
