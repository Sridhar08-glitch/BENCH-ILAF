// Small helpers for the company trust settings (verified domain, reply-to). Pure functions.

/** A domain as the server wants it: no scheme, no path, no www, lower case. */
export function cleanDomainInput(raw: string): string {
  let v = raw.trim().toLowerCase().replace(/^@/, "");
  v = v.replace(/^https?:\/\//, "").split("/")[0];
  return v.replace(/^www\./, "");
}

/** The mailboxes offered for a domain: the three standard ones, written as the short word the server accepts. */
export function mailboxChoices(domain: string): string[] {
  return domain ? ["admin", "postmaster", "webmaster"] : ["admin"];
}

/** A reply-to address as typed: trimmed, no spaces. An empty string clears it. */
export function cleanReplyTo(raw: string): string {
  return raw.replace(/\s+/g, "").toLowerCase();
}

/** True for the free or disposable mail providers the server refuses to verify (a quick hint before sending). */
const FREE = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com",
  "proton.me", "protonmail.com", "pm.me", "aol.com", "gmx.com", "mail.com", "zoho.com", "yandex.com", "qq.com",
]);
export function isFreeMailDomain(domain: string): boolean {
  return FREE.has(domain.trim().toLowerCase());
}
