"use client";

import Link from "next/link";
import { PageHead } from "@/components/app/ui";
import { DeleteAccountPanel, DeleteCompanyPanel, ExportPanels } from "@/components/account/PrivacyPanels";
import { useI18n } from "@/lib/i18n/client";

export default function PrivacyPage() {
  const { t } = useI18n();
  return (
    <div className="view">
      <PageHead title={t("settings.privacyData")} sub={t("settings.privacySub")}>
        <Link className="btn ghost sm" href="/app/settings">{t("settings.backToSettings")}</Link>
      </PageHead>
      <div className="g3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))" }}>
        <ExportPanels />
        <DeleteCompanyPanel />
        <DeleteAccountPanel />
      </div>
    </div>
  );
}
