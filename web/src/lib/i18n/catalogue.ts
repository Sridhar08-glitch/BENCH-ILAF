// Server-side access to the whole catalogue. Never imported by client components.
import { createI18n, type I18n } from "./index";
import type { Digits, Locale } from "./config";
import { CATALOGUES } from "./messages";

/** The translator for a language with every text. */
export function fullI18n(locale: Locale, digits: Digits): I18n {
  return createI18n(locale, digits, CATALOGUES[locale]);
}

/**
 * The texts of some areas in one language, for handing to the browser (a page only ships the areas it uses).
 * `areas` are area names such as "common" and "card".
 */
export function messagesFor(locale: Locale, areas: readonly string[]): Record<string, string> {
  const catalogue = CATALOGUES[locale] as Record<string, string>;
  const out: Record<string, string> = {};
  for (const key of Object.keys(catalogue)) {
    const area = key.slice(0, key.indexOf("."));
    // The error texts go to every page: any screen can show an API error.
    if (area === "apiError" || areas.includes(area)) out[key] = catalogue[key];
  }
  return out;
}
