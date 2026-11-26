import type { Locale, TFunction } from "@/lib/i18n";

/** What every section receives besides its own data: the translator, the page language and the few card facts it may show. */
export interface SectionContext {
  t: TFunction;
  locale: Locale;
  /** The card's public code (the address the cart and booking calls use). */
  code: string;
  publicUrl: string;
  name: string;
  videoUrl: string | null;
  posterUrl: string | null;
}
