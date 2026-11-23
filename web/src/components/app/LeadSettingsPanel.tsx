"use client";

// Owner and admin settings for the contact forms on every card: the privacy page that the consent line
// links to, and (for companies) whether admins are e-mailed about every new contact.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { ToggleRow } from "@/components/app/Switch";
import { useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { ApiError, api } from "@/lib/api";
import { apiErrorText, apiFieldText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";

export function LeadSettingsPanel() {
  const { current, isManager, isCompany } = useWs();
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["lead-settings", current.id], queryFn: () => api.leadSettings(current.id), enabled: isManager });
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setUrl(q.data.privacy_url);
  }, [q.data]);
  if (!isManager) return null;

  async function save(body: { privacy_url?: string; notify_admins?: boolean }) {
    setBusy(true);
    setErr("");
    try {
      const r = await api.updateLeadSettings(current.id, body);
      qc.setQueryData(["lead-settings", current.id], r);
      toast(t("common.saved"));
    } catch (e) {
      setErr(e instanceof ApiError ? apiFieldText(e, "privacy_url", t) || apiErrorText(e, t) : t("contacts.settingsFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel card" noValidate onSubmit={(e) => { e.preventDefault(); void save({ privacy_url: url.trim() }); }}>
      <div className="head"><h2><span className="chip"><Icon name="adduser" size="s" /></span>{t("contacts.formsTitle")}</h2></div>
      <p className="hint">{t("contacts.formsText")}</p>
      <label>
        {t("contacts.privacyLabel")}
        <input value={url} inputMode="url" autoComplete="off" placeholder="https://yourcompany.com/privacy" aria-invalid={!!err} onChange={(e) => setUrl(e.target.value)} className="ltr" dir="ltr" />
        {err && <span className="err" role="alert">{err}</span>}
      </label>
      <button type="submit" className="btn" disabled={busy || q.isLoading}>{t("common.save")}</button>
      {isCompany && (
        <ToggleRow
          first
          title={t("contacts.notifyTitle")}
          hint={t("contacts.notifyHint")}
          checked={q.data?.notify_admins ?? false}
          disabled={busy || q.isLoading}
          onChange={(v) => void save({ notify_admins: v })}
        />
      )}
    </form>
  );
}
