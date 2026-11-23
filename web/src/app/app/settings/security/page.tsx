"use client";

import Link from "next/link";
import { PageHead } from "@/components/app/ui";
import { TwoFactorPanel } from "@/components/account/SecurityPanels";
import { useI18n } from "@/lib/i18n/client";

export default function SecurityPage() {
  const { t } = useI18n();
  return (
    <div className="view">
      <PageHead title={t("security.pageTitle")} sub={t("security.pageSub")}>
        <Link className="btn ghost sm" href="/app/settings">{t("settings.backToSettings")}</Link>
      </PageHead>
      <div className="g3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))" }}>
        <TwoFactorPanel />
        <section className="panel card">
          <div className="head"><h2>{t("security.moreTitle")}</h2></div>
          <div className="hint">{t("security.moreHint")}</div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Link className="btn ghost sm" href="/app/settings/devices">{t("security.devicesTitle")}</Link>
            <Link className="btn ghost sm" href="/app/settings/sign-in">{t("settings.signInMethods")}</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
