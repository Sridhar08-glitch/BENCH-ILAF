"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { companyTrustApi } from "@/lib/security-api";

// The link in the "Confirm your company domain" e-mail. Opening it proves the mailbox; no sign-in is needed.
export default function VerifyDomainPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { t } = useI18n();
  const [state, setState] = useState<{ ok: true; domain: string; company: string } | { ok: false; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    companyTrustApi
      .confirmLink(token)
      .then((r) => live && setState({ ok: true, domain: r.domain, company: r.company }))
      .catch((e) => live && setState({ ok: false, message: apiErrorText(e, t, "security.domainLinkFailed") }));
    return () => {
      live = false;
    };
  }, [token, t]);

  return (
    <div className="pane">
      {state === null && <div className="hint" role="status">{t("security.domainChecking")}</div>}
      {state?.ok && (
        <div className="notice" role="status">
          <div className="grow"><b>{t("security.domainLinkDone")}</b>{t("security.domainLinkDoneText", { domain: state.domain, company: state.company })}</div>
        </div>
      )}
      {state && !state.ok && <div className="notice bad" role="alert">{state.message}</div>}
      <div className="hint"><Link href="/app/settings/company">{t("security.domainLinkBack")}</Link></div>
    </div>
  );
}
