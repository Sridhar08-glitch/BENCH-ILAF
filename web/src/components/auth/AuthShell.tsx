import Link from "next/link";
import styles from "./AuthShell.module.css";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo, Lockup } from "@/components/Logo";
import { APP_NAME, COMPANY_NAME } from "@/lib/config";
import { dirOf, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

interface Props {
  title: string;
  lead?: string;
  children: React.ReactNode;
  /** Small line under the form, for example a link to the other sign-in page. */
  footer?: React.ReactNode;
  /** A language fixed for this page (an invitation's own language when the visitor has not chosen one). */
  locale?: Locale;
}

/** The split screen used by every sign-in page: brand panel, white form. */
export async function AuthShell({ title, lead, children, footer, locale }: Props) {
  const { t, locale: use } = await getI18n(locale);
  return (
    <div className={styles.shell} lang={use} dir={dirOf(use)}>
      <aside className={styles.panel}>
        <Logo />
        <div>
          <h2>
            {t("auth.panelLine1")}<br /><b>{t("auth.panelLine2")}</b>
          </h2>
          <p style={{ marginBlockStart: 16 }}>{t("auth.panelText", { app: APP_NAME })}</p>
        </div>
        <div className={styles.steps}>
          <span>{t("auth.stepCreate")}</span>
          <span>{t("auth.stepShare")}</span>
          <span>{t("auth.stepConnect")}</span>
        </div>
      </aside>
      <main className={styles.form}>
        <div className={styles.lang}><LanguageSwitcher /></div>
        <div className={styles.box}>
          <div className={styles.mobileLogo}><Logo /></div>
          <div>
            <h1>{title}</h1>
            {lead && <p className="sub">{lead}</p>}
          </div>
          {children}
          {footer && <div className="hint">{footer}</div>}
          <div className={styles.foot}>
            <Lockup />
            <span>
              &copy; {COMPANY_NAME} &middot; <Link href="/">{APP_NAME}</Link>
            </span>
            <span>
              <Link href="/privacy">{t("common.privacy")}</Link> &middot; <Link href="/terms">{t("common.terms")}</Link>
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
