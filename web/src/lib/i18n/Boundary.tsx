// Server component: puts the language and the texts of some areas in front of the client components below it.
import type { ReactNode } from "react";
import { messagesFor } from "./catalogue";
import { I18nProvider } from "./client";
import type { Locale } from "./config";
import { getRequestLanguage } from "./server";

export async function I18nBoundary({
  areas, locale, children,
}: { areas: readonly string[]; /** A language fixed by the page (a card's own language); otherwise the visitor's. */ locale?: Locale; children: ReactNode }) {
  const lang = await getRequestLanguage();
  const use = locale ?? lang.locale;
  return (
    <I18nProvider locale={use} digits={lang.digits} messages={messagesFor(use, areas)}>
      {children}
    </I18nProvider>
  );
}
