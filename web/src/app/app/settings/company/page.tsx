"use client";

import Link from "next/link";
import { PageHead } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { EmailBrandingPanel, Require2faPanel, VerifiedDomainsPanel } from "@/components/account/CompanyTrustPanels";
import { useI18n } from "@/lib/i18n/client";

export default function CompanyTrustPage() {
  const { t } = useI18n();
  const { current, isManager } = useWs();
  if (current.kind !== "company" || !isManager) {
    return (
      <div className="view">
        <PageHead title={t("security.companyTitle")} sub={t("security.companyOnly")}>
          <Link className="btn ghost sm" href="/app/settings">{t("settings.backToSettings")}</Link>
        </PageHead>
      </div>
    );
  }
  return (
    <div className="view">
      <PageHead title={t("security.companyTitle")} sub={t("security.companySub", { name: current.name })}>
        <Link className="btn ghost sm" href="/app/settings">{t("settings.backToSettings")}</Link>
      </PageHead>
      <div className="g3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))" }}>
        <Require2faPanel />
        <VerifiedDomainsPanel />
        <EmailBrandingPanel />
      </div>
    </div>
  );
}
