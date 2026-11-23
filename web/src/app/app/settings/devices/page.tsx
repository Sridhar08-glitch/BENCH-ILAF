"use client";

import Link from "next/link";
import { PageHead } from "@/components/app/ui";
import { DevicesPanel } from "@/components/account/SecurityPanels";
import { useI18n } from "@/lib/i18n/client";

export default function DevicesPage() {
  const { t } = useI18n();
  return (
    <div className="view">
      <PageHead title={t("security.devicesTitle")} sub={t("security.devicesSub")}>
        <Link className="btn ghost sm" href="/app/settings">{t("settings.backToSettings")}</Link>
      </PageHead>
      <div className="g3" style={{ gridTemplateColumns: "minmax(0,720px)" }}>
        <DevicesPanel />
      </div>
    </div>
  );
}
