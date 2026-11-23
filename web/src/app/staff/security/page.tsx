"use client";

// My security: the two-step verification of this account and its recovery codes.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { ROLE_KEYS } from "@/components/staff/StaffShell";
import { errorText, staffApi } from "@/lib/designs/api";
import { useI18n } from "@/lib/i18n/client";

export default function SecurityPage() {
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const me = useQuery({ queryKey: ["staff-me"], queryFn: staffApi.me });
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  const m = me.data;
  if (!m) return null;
  return (
    <div className="view" style={{ maxWidth: 560 }}>
      <h1>{t("staff.navSecurity")}</h1>
      <section className="panel" style={{ padding: 16, display: "grid", gap: 8 }}>
        <div>{m.email} · {t(ROLE_KEYS[m.staff_role])}</div>
        <div className="hint">{t("staff.sessionUntil", { when: m.verified_until ? dateTime(m.verified_until) : "-" })}</div>
        <div className="hint">{t("staff.codesLeft", { n: m.recovery_codes_left })}</div>
        <div>
          <button className="btn ghost" onClick={async () => { setErr(""); try { setCodes((await staffApi.newRecoveryCodes()).recovery_codes); toast(t("staff.saved")); } catch (e) { setErr(errorText(e, t)); } }}>{t("staff.newCodes")}</button>
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        {codes && (<><p className="sub">{t("staff.recoveryText")}</p><pre className="mono" style={{ columns: 2, margin: 0 }}>{codes.join("\n")}</pre></>)}
      </section>
    </div>
  );
}
