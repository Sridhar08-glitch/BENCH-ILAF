// The words of a card page in the card's language: the button names, "Save contact", the flip hint and the footer.
// A card is shown in its own language (or the visitor's), not the dashboard's, so these come straight from the
// card area of the catalogue and are available wherever a card is drawn (server page, editor preview).
import { card as enCard } from "@/lib/i18n/en/card";
import { card as arCard } from "@/lib/i18n/ar/card";
import { createI18n, type I18n } from "@/lib/i18n";
import type { Digits, Locale } from "@/lib/i18n/config";
import { APP_NAME, COMPANY_SHORT_NAME } from "@/lib/config";
import { localiseWords } from "./chrome-words";

const CARD_TEXTS: Record<Locale, Record<string, string>> = { en: enCard, ar: arCard };

/** The translator for card words in a language. */
export function cardI18n(locale: Locale, digits: Digits = "latn"): I18n {
  return createI18n(locale, digits, CARD_TEXTS[locale]);
}

export interface CardLabels {
  save: string;
  hint: string;
  back: string;
  flip: string;
  qr: string;
  footer: string;
}

export function cardLabels(i18n: I18n): CardLabels {
  return {
    save: i18n.t("card.save"),
    hint: i18n.t("card.flipHint"),
    back: i18n.t("card.backCaption"),
    flip: i18n.t("card.flipAria"),
    qr: i18n.t("card.qrAria"),
    footer: i18n.t("card.footer", { app: APP_NAME, company: COMPANY_SHORT_NAME }),
  };
}

/**
 * The drawing engine writes its few fixed words in English. This puts the card's language in their place and
 * swaps the decorative words of the designs, so a card in Arabic does not say "Save contact".
 */
export function localiseChrome(html: string, locale: Locale, labels: CardLabels): string {
  let out = html;
  if (locale !== "en") {
    out = out
      .replace(/Tap the card to flip it/g, labels.hint)
      .replace(/Scan to save my contact/g, labels.back)
      .replace(/aria-label="Flip card"/g, `aria-label="${esc(labels.flip)}"`)
      .replace(/aria-label="QR code"/g, `aria-label="${esc(labels.qr)}"`)
      .replace(/Save contact</g, `${esc(labels.save)}<`);
    out = localiseWords(out, locale);
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
