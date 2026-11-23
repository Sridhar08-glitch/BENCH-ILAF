import Link from "next/link";
import styles from "./PublicCard.module.css";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { COMPANY_NAME } from "@/lib/config";
import { dirOf, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

interface Props {
  kind: "paused" | "suspended" | "missing";
  companyName?: string | null;
  message?: string;
  website?: string | null;
  locale?: Locale;
}

/** Friendly page for a card that is paused, removed or does not exist. */
export async function StateScreen({ kind, companyName, message, website, locale }: Props) {
  const { t, locale: use } = await getI18n(locale);
  const title =
    kind === "paused" ? t("card.statePausedTitle") : kind === "suspended" ? t("card.stateSuspendedTitle") : t("card.stateMissingTitle");
  // The API's own message is English; the page says it in the visitor's language.
  const body = kind === "missing" ? t("card.stateMissingBody") : message && use === "en" ? message : t("card.stateDefaultBody");
  let siteHref: string | null = null;
  if (website) {
    const w = website.trim();
    if (/^https?:\/\//i.test(w)) siteHref = w;
    else if (!/^[a-z][a-z0-9+.-]*:/i.test(w)) siteHref = `https://${w}`;
  }
  return (
    <main className={styles.state} lang={use} dir={dirOf(use)}>
      <div className={styles.stateBox}>
        <Logo />
        <span className={styles.stateIcon}><Icon name={kind === "paused" ? "clock" : "alert"} size="l" /></span>
        {companyName && <p className="eyebrow" dir="auto">{companyName}</p>}
        <h1>{title}</h1>
        <p className="sub">{body}</p>
        {siteHref && (
          <a className="btn" href={siteHref} target="_blank" rel="noopener noreferrer">
            {companyName ? t("card.visitSite", { name: companyName }) : t("card.visitTheirSite")}
          </a>
        )}
        <Link className="btn ghost" href="/">{t("card.whatIsThis")}</Link>
        <p className="hint">&copy; {COMPANY_NAME}</p>
      </div>
    </main>
  );
}
