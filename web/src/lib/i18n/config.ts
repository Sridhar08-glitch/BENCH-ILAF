// Languages of the app and how the language of a visit is chosen. No dependencies, so it runs on the server,
// in the browser and in the tests.

/** Every language the app can show. English is the source language. To add one, see README "Languages". */
export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Languages written right to left. */
export const RTL_LOCALES: readonly Locale[] = ["ar"];

/** Each language written in itself, for the language switcher. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", ar: "العربية" };

/** The cookie that remembers the visitor's language (it mirrors the account's language when signed in). */
export const LANG_COOKIE = "bench_lang";
/** The cookie that remembers the digit style. */
export const DIGITS_COOKIE = "bench_digits";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Digits: "latn" is 0-9 (the default), "arab" is the Eastern Arabic-Indic digits. */
export type Digits = "latn" | "arab";
export const DEFAULT_DIGITS: Digits = "latn";

/** A supported language from a value such as "ar", "AR" or "ar-QA"; null when it is not supported. */
export function normaliseLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase().replace(/_/g, "-").split("-")[0];
  return (LOCALES as readonly string[]).includes(code) ? (code as Locale) : null;
}

export function normaliseDigits(value: unknown): Digits {
  return value === "arab" ? "arab" : DEFAULT_DIGITS;
}

export function dirOf(locale: Locale): "rtl" | "ltr" {
  return RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
}

export function isRtl(locale: Locale): boolean {
  return dirOf(locale) === "rtl";
}

/** The best supported language of an Accept-Language header, or null. */
export function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked: { q: number; i: number; locale: Locale }[] = [];
  header.split(",").forEach((part, i) => {
    const [tag, ...params] = part.trim().split(";");
    const locale = normaliseLocale(tag);
    if (!locale) return;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([\d.]+)\s*$/.exec(p);
      if (m) q = Number(m[1]);
    }
    if (q > 0) ranked.push({ q, i, locale });
  });
  ranked.sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked[0]?.locale ?? null;
}

/** The language of a visit: the account's setting, then the cookie, then the browser's, then English. */
export function pickLocale(src: { account?: unknown; cookie?: unknown; acceptLanguage?: string | null }): Locale {
  return normaliseLocale(src.account) ?? normaliseLocale(src.cookie) ?? fromAcceptLanguage(src.acceptLanguage) ?? DEFAULT_LOCALE;
}

/** The language of a public card: its own setting, or "auto" which follows the visitor. */
export type CardLanguage = Locale | "auto";
export const CARD_LANGUAGES: readonly CardLanguage[] = ["auto", ...LOCALES];

export function normaliseCardLanguage(value: unknown): CardLanguage {
  return value === "auto" ? "auto" : normaliseLocale(value) ?? "auto";
}

/** The language a card page is shown in. */
export function cardLocale(card: CardLanguage, visitor: Locale): Locale {
  return card === "auto" ? visitor : card;
}

/** The BCP 47 tag handed to Intl: the language with explicit digits and the Gregorian calendar. */
export function intlTag(locale: Locale, digits: Digits): string {
  // English dates read day first (22 Nov 2026), the way the Gulf writes them.
  const language = locale === "en" ? "en-GB" : locale;
  return `${language}-u-ca-gregory-nu-${locale === "ar" ? digits : "latn"}`;
}
