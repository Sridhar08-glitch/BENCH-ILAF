import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { getI18n } from "@/lib/i18n/server";
import { COMPANY_SIZES } from "@/lib/staff-admin/sizes";
import { countryOptions } from "@/lib/countries";

// "Request access / talk to us": a plain form (no script needed) that creates an application on the staff board.
type Props = { searchParams: Promise<{ sent?: string; error?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("bo.accessTitle") };
}

export default async function RequestAccessPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { t, locale } = await getI18n();
  if (sp.sent) {
    return (
      <AuthShell title={t("bo.accessThanks")} lead={t("bo.accessThanksText")}>
        <span />
      </AuthShell>
    );
  }
  return (
    <AuthShell title={t("bo.accessTitle")} lead={t("bo.accessLead")}>
      <form method="post" action="/request-access/send" style={{ display: "grid", gap: 14 }}>
        {sp.error && <div className="notice bad" role="alert">{t("bo.accessError")}</div>}
        <label style={{ display: "grid", gap: 4 }}>{t("bo.accessCompany")}<input name="company" required maxLength={120} autoComplete="organization" /></label>
        <label style={{ display: "grid", gap: 4 }}>{t("bo.accessName")}<input name="name" required maxLength={120} autoComplete="name" /></label>
        <label style={{ display: "grid", gap: 4 }}>{t("bo.accessEmail")}<input type="email" name="email" required maxLength={254} autoComplete="email" /></label>
        <label style={{ display: "grid", gap: 4 }}>
          {t("bo.accessSize")}
          <select name="size" defaultValue="">
            <option value="">{t("bo.accessSizeChoose")}</option>
            {COMPANY_SIZES.map((s) => <option key={s} value={s}>{t("bo.accessSizePeople", { range: s })}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          {t("bo.accessCountry")}
          <select name="country" defaultValue="">
            <option value="">{t("bo.accessSizeChoose")}</option>
            {countryOptions(locale).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>{t("bo.accessMessage")}<textarea name="message" rows={3} maxLength={1000} /></label>
        <div aria-hidden="true" style={{ position: "absolute", insetInlineStart: -9999, width: 1, height: 1, overflow: "hidden" }}>
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </div>
        <button type="submit" className="btn">{t("bo.accessSend")}</button>
      </form>
    </AuthShell>
  );
}
