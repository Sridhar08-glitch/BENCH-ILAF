"use client";

// Hooks that bind api-error.ts to the language of the page.
import { useCallback } from "react";
import { apiErrorText, apiFieldText } from "./api-error";
import { useI18n } from "./client";
import type { MessageKey } from "./index";

/** `const errorText = useApiErrorText(); toast(errorText(e, "contacts.saveFailed"))`. */
export function useApiErrorText(): (error: unknown, fallbackKey?: MessageKey) => string {
  const { t, locale } = useI18n();
  return useCallback((error, fallbackKey) => apiErrorText(error, t, fallbackKey, locale), [t, locale]);
}

/** The text of one field of a validation error, in the page's language. */
export function useApiFieldText(): (error: unknown, field: string) => string | undefined {
  const { t, locale } = useI18n();
  return useCallback((error, field) => apiFieldText(error, field, t, locale), [t, locale]);
}
