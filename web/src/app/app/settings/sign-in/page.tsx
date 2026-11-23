"use client";

import Link from "next/link";
import { PageHead } from "@/components/app/ui";
import { CompanySecurityPanel, GooglePanel, SetPasswordPanel, SignOutAllPanel } from "@/components/account/SignInPanels";
import { useI18n } from "@/lib/i18n/client";

export default function SignInMethodsPage() {
  const { t } = useI18n();
  return (
    <div className="view">
      <PageHead title={t("settings.signInMethods")} sub={t("settings.signInSub")}>
        <Link className="btn ghost sm" href="/app/settings">{t("settings.backToSettings")}</Link>
      </PageHead>
      <div className="g3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))" }}>
        <GooglePanel />
        <SetPasswordPanel />
        <CompanySecurityPanel />
        <SignOutAllPanel />
      </div>
    </div>
  );
}
