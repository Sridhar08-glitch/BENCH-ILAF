import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { fetchPublicCard } from "@/lib/public-api";
import { getCustomHost } from "@/lib/server/custom-host";
import { cardHref } from "@/lib/card-address";
import { dirOf } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { REPORT_REASONS } from "@/lib/server/public-form";
import type { MessageKey } from "@/lib/i18n";

// "Report this card": a small page with a plain form (no script needed). Never indexed.
type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ sent?: string; error?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("bo.reportTitle"), robots: { index: false, follow: false } };
}

const REASON_TEXT: Record<(typeof REPORT_REASONS)[number], MessageKey> = {
  spam: "bo.reasonSpam", fake: "bo.reasonFake", offensive: "bo.reasonOffensive", impersonation: "bo.reasonImpersonation", other: "bo.reasonOther",
};

export default async function ReportPage({ params, searchParams }: Props) {
  const { code } = await params;
  const sp = await searchParams;
  const { host } = await getCustomHost();
  const data = await fetchPublicCard(code, host);
  if (!data || data.state !== "live") notFound();
  const { t, locale } = await getI18n();
  const back = cardHref(data.canonical, host);
  return (
    <main lang={locale} dir={dirOf(locale)} style={{ maxWidth: 520, margin: "0 auto", padding: "28px 18px 48px", display: "grid", gap: 16 }}>
      <Logo />
      {sp.sent ? (
        <div className="panel" style={{ padding: 20, display: "grid", gap: 10 }} role="status">
          <h1>{t("bo.reportThanks")}</h1>
          <p className="sub">{t("bo.reportThanksText")}</p>
          <Link className="btn" href={back}>{t("bo.reportBack")}</Link>
        </div>
      ) : (
        <form method="post" action={`${back}/report/send`} className="panel" style={{ padding: 20, display: "grid", gap: 14 }}>
          <h1>{t("bo.reportTitle")}</h1>
          <p className="sub">{t("bo.reportLead")}</p>
          <p className="hint">{t("bo.reportCard", { name: data.card.name })}</p>
          {sp.error && <div className="notice bad" role="alert">{t("bo.reportError")}</div>}
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
            <legend style={{ fontWeight: 700, marginBlockEnd: 6 }}>{t("bo.reportReason")}</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="radio" name="reason" value={r} required /> {t(REASON_TEXT[r])}
              </label>
            ))}
          </fieldset>
          <label style={{ display: "grid", gap: 4 }}>{t("bo.reportNote")}<textarea name="note" rows={3} maxLength={500} /></label>
          <label style={{ display: "grid", gap: 4 }}>{t("bo.reportEmail")}<input type="email" name="email" maxLength={254} autoComplete="email" /><span className="hint">{t("bo.reportEmailHint")}</span></label>
          {/* Bots fill every field: a person never sees or fills this one. */}
          <div aria-hidden="true" style={{ position: "absolute", insetInlineStart: -9999, width: 1, height: 1, overflow: "hidden" }}>
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </div>
          <div className="row"><button type="submit" className="btn">{t("bo.reportSend")}</button><Link className="btn ghost" href={back}>{t("bo.reportBack")}</Link></div>
        </form>
      )}
    </main>
  );
}
