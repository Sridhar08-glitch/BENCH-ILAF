"use client";

// A company that requires 2-step verification: members without it see a banner during the grace period, and after it
// only the security pages open until they have turned it on.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/lib/i18n/client";
import { isSecurityPath } from "@/lib/two-factor";
import { useWs } from "./WorkspaceContext";

export function TwoFactorNotice() {
  const { user } = useWs();
  const { t, date } = useI18n();
  const pathname = usePathname();
  const required = user.two_factor?.required;
  if (!required || user.two_factor?.enabled || isSecurityPath(pathname)) return null;
  return (
    <div className={`notice ${required.enforced ? "bad" : "warn"}`} role="status" aria-live="polite">
      <Icon name="lock" />
      <div className="grow">
        <b>{t("security.bannerTitle")}</b>
        {required.enforced
          ? t("security.bannerEnforced", { company: required.workspace_name })
          : t("security.bannerText", { company: required.workspace_name, date: date(required.deadline) })}
      </div>
      <Link className="btn sm" href="/app/settings/security">{t("security.bannerButton")}</Link>
    </div>
  );
}

/** Past the grace period the rest of the app is replaced by this page (the API refuses those requests anyway). */
export function TwoFactorGate({ children }: { children: React.ReactNode }) {
  const { user } = useWs();
  const { t } = useI18n();
  const pathname = usePathname();
  const required = user.two_factor?.required;
  if (required?.enforced && !user.two_factor?.enabled && !isSecurityPath(pathname)) {
    return (
      <div className="view">
        <div className="panel card" role="alert">
          <div className="head"><h2><span className="chip"><Icon name="lock" size="s" /></span>{t("security.gateTitle")}</h2></div>
          <div className="hint">{t("security.gateText", { company: required.workspace_name })}</div>
          <div><Link className="btn" href="/app/settings/security">{t("security.bannerButton")}</Link></div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
