// The one place that turns a failed API call into text for the screen. A page never shows `error.message` itself:
// the server's sentence is in English unless the API knew its translation, so the text comes from the error code
// (`apiError.<code>` in the catalogue). Import this file directly (it is not part of ./index).
// Components can also use the hooks in ./use-api-error.
import { runtimeLocale, type Locale, type MessageKey, type TFunction } from "./index";

/** What an ApiError carries (lib/api.ts), without importing it. */
export interface ApiErrorLike {
  code: string;
  message: string;
  status?: number;
  fields?: Record<string, string[]>;
  retryAfter?: number;
}

export function isApiErrorLike(e: unknown): e is ApiErrorLike {
  return e instanceof Error && typeof (e as { code?: unknown }).code === "string" && typeof (e as { fields?: unknown }).fields === "object";
}

/** Codes that many different sentences share: the server's own sentence says more than the code does. */
const MESSAGE_FIRST = new Set(["validation_error", "forbidden", "not_found", "plan_limit", "subscription_required", "field_locked", "slug_taken", "error"]);

const ARABIC_LETTER = /[؀-ۿݐ-ݿ]/;

/** True when the server's sentence is fit to show: English on an English screen, or an Arabic sentence the API translated. */
function usable(text: string | undefined, locale: Locale | null): text is string {
  if (!text || !text.trim()) return false;
  return locale === "ar" ? ARABIC_LETTER.test(text) : !ARABIC_LETTER.test(text);
}

function codeText(code: string, t: TFunction, params?: Record<string, string | number>): string | null {
  const key = `apiError.${code}` as MessageKey;
  const text = t(key, params);
  return text === key ? null : text;
}

/**
 * The text to show for a failed call. Order: the catalogue text of the code (except for codes that share many
 * sentences, where the server's own sentence comes first when it is in the screen's language), then `fallbackKey`,
 * then, on an English screen only, the server's sentence, then the generic text. Arabic never shows raw English.
 */
export function apiErrorText(error: unknown, t: TFunction, fallbackKey?: MessageKey, locale: Locale | null = runtimeLocale()): string {
  const fallback = () => (fallbackKey ? t(fallbackKey) : t("apiError.generic"));
  if (!isApiErrorLike(error)) return fallback();
  if (error.code === "throttled") return t("apiError.throttled", { n: error.retryAfter || 60 });
  if (MESSAGE_FIRST.has(error.code)) {
    if (error.code === "validation_error") {
      const first = Object.values(error.fields ?? {})[0]?.[0];
      if (usable(first, locale)) return first;
    }
    if (usable(error.message, locale)) return error.message;
    return codeText(error.code, t) ?? fallback();
  }
  const known = codeText(error.code, t);
  if (known) return known;
  if (fallbackKey) return t(fallbackKey);
  return locale !== "ar" && usable(error.message, locale) ? error.message : t("apiError.generic");
}

/** The text for one field of a validation error, in the screen's language (`apiError.field` when the API sent none usable). */
export function apiFieldText(error: unknown, field: string, t: TFunction, locale: Locale | null = runtimeLocale()): string | undefined {
  if (!isApiErrorLike(error)) return undefined;
  const text = error.fields?.[field]?.[0];
  if (text === undefined) return undefined;
  return usable(text, locale) ? text : t("apiError.field");
}

/** A sentence that travels inside a successful answer (an import row, a refused item of a bulk run) in the screen's language. */
export function apiServerText(text: string | null | undefined, t: TFunction, fallbackKey?: MessageKey, locale: Locale | null = runtimeLocale()): string {
  if (usable(text ?? undefined, locale)) return text as string;
  return fallbackKey ? t(fallbackKey) : t("apiError.generic");
}

/** The reason of a refused item: the text of its code when the code has its own, else its sentence when it is in the screen's language. */
export function apiReasonText(item: { reason?: string | null; code?: string | null }, t: TFunction, fallbackKey?: MessageKey, locale: Locale | null = runtimeLocale()): string {
  if (item.code && !MESSAGE_FIRST.has(item.code)) {
    const known = codeText(item.code, t);
    if (known) return known;
  }
  return apiServerText(item.reason, t, fallbackKey, locale);
}

/** The first field message, else the error text: for forms that show one box for the whole answer. */
export function apiFirstFieldText(error: unknown, t: TFunction, fallbackKey?: MessageKey, locale: Locale | null = runtimeLocale()): string {
  if (isApiErrorLike(error)) {
    const first = Object.keys(error.fields ?? {})[0];
    if (first) {
      const text = apiFieldText(error, first, t, locale);
      if (text) return text;
    }
  }
  return apiErrorText(error, t, fallbackKey, locale);
}
