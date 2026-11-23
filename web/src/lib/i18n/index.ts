// The translator: t(area.key, { values }) plus number, date and money formatting in the language.
// Works the same on the server and in the browser. Server pages use `getI18n()` (./server), client components
// `useI18n()` (./client). This file never imports the catalogues, so the browser only receives the texts a
// page hands it (see `messagesFor` in ./catalogue).
import { dirOf, intlTag, type Digits, type Locale } from "./config";
import {
  format, formatCompact, formatDate, formatDateTime, formatList, formatMoney, formatNumber, formatRelative, formatTime,
  type FormatContext, type Params,
} from "./format";
import type { MessageKey } from "./messages";

export * from "./config";
export { format, placeholdersOf, pluralCategory } from "./format";
export type { Params } from "./format";
export type { MessageKey } from "./messages";

export type TFunction = (key: MessageKey, params?: Params) => string;

export interface I18n {
  locale: Locale;
  dir: "rtl" | "ltr";
  digits: Digits;
  /** The BCP 47 tag for Intl (language, calendar and digits). */
  tag: string;
  t: TFunction;
  number: (n: number, options?: Intl.NumberFormatOptions) => string;
  compact: (n: number) => string;
  date: (d: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  dateTime: (d: Date | string | number) => string;
  time: (d: Date | string | number) => string;
  relative: (d: Date | string | number) => string;
  /** Money from minor units (cents, fils). */
  money: (minor: number, currency: string) => string;
  list: (items: string[]) => string;
}

/** Marks a message key that is chosen at run time, so the "unused keys" test still sees it as used. */
export function tk<K extends MessageKey>(key: K): K {
  return key;
}

/** Build the translator for a language from the texts it was given (a whole catalogue or some areas of it). */
export function createI18n(locale: Locale, digits: Digits, dict: Partial<Record<string, string>>): I18n {
  const ctx: FormatContext = { locale, digits };
  const t: TFunction = (key, params) => format(dict[key] ?? key, params, ctx);
  return {
    locale,
    dir: dirOf(locale),
    digits,
    tag: intlTag(locale, digits),
    t,
    number: (n, options) => formatNumber(n, ctx, options),
    compact: (n) => formatCompact(n, ctx),
    date: (d, options) => formatDate(d, ctx, options),
    dateTime: (d) => formatDateTime(d, ctx),
    time: (d) => formatTime(d, ctx),
    relative: (d) => formatRelative(d, ctx),
    money: (minor, currency) => formatMoney(minor, currency, ctx),
    list: (items) => formatList(items, ctx),
  };
}

// ---------------------------------------------------------------- code outside React
let runtime: I18n | null = null;

/** The browser provider registers its translator here so plain modules (the API client) can speak the language. */
export function setRuntimeI18n(i18n: I18n): void {
  runtime = i18n;
}

/** The language the browser provider registered, or null before one has. */
export function runtimeLocale(): Locale | null {
  return runtime ? runtime.locale : null;
}

/** Translate outside React. Before a provider has registered, the key itself comes back. */
export function runtimeT(key: MessageKey, params?: Params): string {
  return runtime ? runtime.t(key, params) : key;
}
