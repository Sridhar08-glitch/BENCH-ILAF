import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./legal.module.css";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo, Lockup } from "@/components/Logo";
import { APP_NAME, COMPANY_NAME } from "@/lib/config";
import { dirOf } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import type { Block, Inline } from "@/lib/legal/markdown";
import { legalSettings, loadLegal, type LegalDoc } from "@/lib/server/legal";

function inline(items: Inline[]): ReactNode[] {
  return items.map((i, n) =>
    i.kind === "bold" ? <strong key={n}>{i.text}</strong>
    : i.kind === "link" ? <Link key={n} href={i.href}>{i.text}</Link>
    : <span key={n}>{i.text}</span>,
  );
}

function blocks(list: Block[]): ReactNode[] {
  return list.map((b, n) => {
    if (b.kind === "h1") return null; // the title is drawn by the page itself
    if (b.kind === "h2") return <h2 key={n}>{inline(b.inline)}</h2>;
    if (b.kind === "h3") return <h3 key={n}>{inline(b.inline)}</h3>;
    if (b.kind === "ul") return <ul key={n}>{b.items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ul>;
    return <p key={n}>{inline(b.inline)}</p>;
  });
}

/** The public privacy policy or terms page: draft banner (unless switched off), the document, links to the other page. */
export async function LegalPage({ doc }: { doc: LegalDoc }) {
  const { t, locale } = await getI18n();
  const settings = legalSettings();
  const content = loadLegal(doc, locale, t("legal.supportMissing"), settings);
  const title = t(doc === "privacy" ? "legal.privacyTitle" : "legal.termsTitle");
  return (
    <div className={styles.page} lang={locale} dir={dirOf(locale)}>
      <header className={styles.top}>
        <Logo />
        <LanguageSwitcher />
      </header>
      <main className={styles.main}>
        {settings.draftBanner && (
          <div className={styles.draft} role="note">
            <b>{t("legal.draftTitle")}</b>
            <span>{t("legal.draftText")}</span>
          </div>
        )}
        <h1>{title}</h1>
        <div className={styles.body}>{blocks(content)}</div>
      </main>
      <footer className={styles.foot}>
        <nav aria-label={t("legal.navLabel")} className={styles.links}>
          <Link href="/privacy" aria-current={doc === "privacy" ? "page" : undefined}>{t("legal.privacyTitle")}</Link>
          <Link href="/terms" aria-current={doc === "terms" ? "page" : undefined}>{t("legal.termsTitle")}</Link>
          <Link href="/">{t("legal.backHome", { app: APP_NAME })}</Link>
        </nav>
        <Lockup />
        <span>&copy; {COMPANY_NAME}</span>
      </footer>
    </div>
  );
}
