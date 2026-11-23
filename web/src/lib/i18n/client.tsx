"use client";

// The translator for client components. A layout hands it the language and the texts of the areas it uses.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_DIGITS, type Digits, type Locale } from "./config";
import { createI18n, setRuntimeI18n, type I18n } from "./index";

const Context = createContext<I18n | null>(null);

export function I18nProvider({
  locale, digits = DEFAULT_DIGITS, messages, children,
}: { locale: Locale; digits?: Digits; messages: Record<string, string>; children: ReactNode }) {
  const value = useMemo(() => createI18n(locale, digits, messages), [locale, digits, messages]);
  setRuntimeI18n(value);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The translator and the formatters: `const { t, locale, dir, number, date, money } = useI18n()`. */
export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) throw new Error("useI18n needs an I18nProvider above it.");
  return value;
}

export function useT(): I18n["t"] {
  return useI18n().t;
}

/** The translator when a provider is above, otherwise null (for shared pieces such as the logo that can appear anywhere). */
export function useOptionalI18n(): I18n | null {
  return useContext(Context);
}
