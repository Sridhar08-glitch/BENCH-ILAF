// The language of a request on the server: the cookie that mirrors the account's setting, then the browser's
// Accept-Language, then English.
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { fullI18n } from "./catalogue";
import {
  DIGITS_COOKIE, LANG_COOKIE, fromAcceptLanguage, normaliseDigits, normaliseLocale, pickLocale,
  type Digits, type Locale,
} from "./config";
import type { I18n } from "./index";

export interface RequestLanguage {
  locale: Locale;
  digits: Digits;
  /** True when the visitor (or their account) chose the language, false when it was guessed from the browser. */
  chosen: boolean;
  /** The browser's own preference, when it names a supported language. */
  browser: Locale | null;
}

export const getRequestLanguage = cache(async (): Promise<RequestLanguage> => {
  const jar = await cookies();
  const h = await headers();
  const cookie = jar.get(LANG_COOKIE)?.value;
  const browser = fromAcceptLanguage(h.get("accept-language"));
  return {
    locale: pickLocale({ cookie, acceptLanguage: h.get("accept-language") }),
    digits: normaliseDigits(jar.get(DIGITS_COOKIE)?.value),
    chosen: normaliseLocale(cookie) !== null,
    browser,
  };
});

/** The translator for this request. Server components call `const { t } = await getI18n()`. */
export async function getI18n(override?: Locale): Promise<I18n> {
  const lang = await getRequestLanguage();
  return fullI18n(override ?? lang.locale, lang.digits);
}
