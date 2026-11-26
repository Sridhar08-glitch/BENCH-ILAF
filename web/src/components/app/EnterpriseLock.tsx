"use client";

// The note shown instead of an Enterprise-only screen (or part of one) on a plan that does not have it.
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { PageHead } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { ENTERPRISE_FORM_HREF } from "@/lib/enterprise";
import { useI18n } from "@/lib/i18n/client";
import type { EnterpriseFeature } from "@/lib/types";

export function EnterpriseLock({ compact }: { compact?: boolean }) {
  const { t } = useI18n();
  const { role } = useWs();
  return (
    <div className="notice warn" role="status" data-testid="enterprise-lock">
      <Icon name="lock" />
      <div className="grow">
        <b>{t("billing.entLockTitle")}</b>
        {compact ? null : t("billing.entLockText")}
        <div style={{ marginBlockStart: 8 }}>
          {role === "owner" ? (
            <Link className="btn sm" href={ENTERPRISE_FORM_HREF}>{t("billing.entLockCta")}</Link>
          ) : (
            <small>{t("billing.entLockAdmin")}</small>
          )}
        </div>
      </div>
    </div>
  );
}

/** A whole screen that needs Enterprise: the lock note under the page title, or the screen itself. */
export function EnterpriseGate({ feature, title, sub, children }: { feature: EnterpriseFeature; title: string; sub?: string; children?: React.ReactNode }) {
  const { has, isCompany } = useWs();
  if (!isCompany || has(feature)) return <>{children}</>;
  return (
    <div className="view">
      <PageHead title={title} sub={sub} />
      <EnterpriseLock />
    </div>
  );
}
