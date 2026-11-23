"use client";

// Language and digit pickers. The choice is remembered in a cookie (so signed-out pages follow it too) and, when
// someone is signed in, saved to their account so their e-mails and other devices use it as well.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import {
  COOKIE_MAX_AGE, DIGITS_COOKIE, LANG_COOKIE, LOCALES, LOCALE_NAMES, type Digits, type Locale,
} from "@/lib/i18n/config";

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

export function LanguageSwitcher({ signedIn = false, label = true, className }: { signedIn?: boolean; label?: boolean; className?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function pick(next: Locale) {
    if (next === locale) return;
    setBusy(true);
    setCookie(LANG_COOKIE, next);
    if (signedIn) {
      try {
        await api.updateMe({ language: next });
      } catch {
        /* the cookie still switches this device */
      }
    }
    router.refresh();
    setBusy(false);
  }

  return (
    <label className={className ?? "langpick"}>
      {label && <span className="sr-only">{t("common.language")}</span>}
      <select aria-label={t("common.language")} value={locale} disabled={busy} onChange={(e) => void pick(e.target.value as Locale)}>
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>{LOCALE_NAMES[l]}</option>
        ))}
      </select>
    </label>
  );
}

/** Western (0-9) or Eastern Arabic-Indic digits. Only matters when the app is in Arabic. */
export function DigitsSwitcher() {
  const { digits, t } = useI18n();
  const router = useRouter();
  function pick(next: Digits) {
    setCookie(DIGITS_COOKIE, next);
    router.refresh();
  }
  return (
    <select aria-label={t("common.digits")} value={digits} onChange={(e) => pick(e.target.value as Digits)}>
      <option value="latn">{t("common.digitsLatin")}</option>
      <option value="arab">{t("common.digitsArabic")}</option>
    </select>
  );
}
