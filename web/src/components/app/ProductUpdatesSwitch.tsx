"use client";

// "Send me product updates by e-mail": the person's consent for announcement e-mails (service e-mails always arrive).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWs } from "@/components/app/WorkspaceContext";
import { api } from "@/lib/api";
import { keys } from "@/lib/hooks";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";

export function ProductUpdatesSwitch() {
  const { user } = useWs();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function change(on: boolean) {
    setBusy(true);
    setErr("");
    try {
      await api.updateMe({ product_updates: on });
      await qc.invalidateQueries({ queryKey: keys.me });
    } catch (e) {
      setErr(apiErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pane" style={{ gap: 6 }}>
      <label className="row"><input type="checkbox" checked={user.product_updates === true} disabled={busy} onChange={(e) => void change(e.target.checked)} /> {t("bo.productUpdates")}</label>
      {err && <span className="err" role="alert">{err}</span>}
    </div>
  );
}
