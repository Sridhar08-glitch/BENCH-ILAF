// Small helpers for the 2-step verification screens. Pure functions.

/** The six digits of an authenticator code, whatever spaces or dashes were typed or pasted (and Arabic-Indic digits). */
export function cleanCode(text: string): string {
  const ascii = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
  return ascii.replace(/\D/g, "").slice(0, 6);
}

/** A recovery code without spaces, upper case or lower case does not matter on the server; dashes are kept out. */
export function cleanRecovery(text: string): string {
  return text.replace(/[\s-]/g, "").toLowerCase().slice(0, 10);
}

/** The recovery codes as a text file body: one per line, with a short note on top. */
export function recoveryFileText(codes: string[], note: string): string {
  return `${note}\n\n${codes.join("\n")}\n`;
}

/** An authenticator secret in groups of four ("ABCD EFGH ..."), easier to type by hand. */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

/** The otpauth address drawn as a QR code (SVG text). */
export function otpauthIsSafe(uri: string): boolean {
  return /^otpauth:\/\/totp\/[^\s]+\?secret=[A-Z2-7]+&/.test(uri);
}

/** The pages that stay open for a member who has not turned on a required 2-step verification yet. */
export function isSecurityPath(pathname: string | null): boolean {
  return !!pathname && /^\/app\/settings\/(security|devices)(\/|$)/.test(pathname);
}
