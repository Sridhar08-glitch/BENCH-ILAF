"use client";

// A company that is waiting to be deleted is closed. The owner sees a banner (restore it, or download the contacts);
// everybody else gets a page that says so and offers their own workspace.
import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { useWs } from "./WorkspaceContext";
import { useToast } from "./ui";
import { privacyApi } from "@/lib/account-api";
import { crm } from "@/lib/crm/api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";

/** For the owner: the company is scheduled for deletion. */
export function ClosedBanner({ due }: { due: string }) {
  const { current } = useWs();
  const { t, date } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<"" | "restore" | "download">("");
  const [err, setErr] = useState("");
  const [truncated, setTruncated] = useState(false);

  async function restore() {
    setErr("");
    setBusy("restore");
    try {
      await privacyApi.restoreCompany(current.id);
      await qc.invalidateQueries();
      toast(t("shell.closedRestored"));
    } catch (e) {
      setErr(apiErrorText(e, t, "shell.closedFailed"));
    } finally {
      setBusy("");
    }
  }

  async function download() {
    setErr("");
    setTruncated(false);
    setBusy("download");
    try {
      const r = await crm.downloadLeadsCsv(current.id, {}, false);
      if (r.truncated) setTruncated(true);
    } catch (e) {
      setErr(apiErrorText(e, t, "shell.closedFailed"));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="notice bad" role="status">
      <Icon name="alert" />
      <div className="grow">
        <b>{t("shell.closedBannerTitle")}</b>
        {t("shell.closedBannerText", { date: date(due) })}
        <div className="row" style={{ marginBlockStart: 8 }}>
          <button type="button" className="btn sm" disabled={busy !== ""} onClick={() => void restore()}>{busy === "restore" ? t("shell.closedRestoring") : t("shell.closedRestore")}</button>
          <button type="button" className="btn ghost sm" disabled={busy !== ""} onClick={() => void download()}><Icon name="download" size="s" />{busy === "download" ? t("shell.closedDownloading") : t("shell.closedDownload")}</button>
        </div>
        {truncated && <div className="hint" style={{ marginBlockStart: 6 }}>{t("shell.closedTruncated")}</div>}
        {err && <span className="err" role="alert">{err}</span>}
      </div>
    </div>
  );
}

/** The product team suspended the company: everybody sees this page. */
export function SuspendedPage() {
  const { current, workspaces, setCurrent } = useWs();
  const { t } = useI18n();
  const personal = workspaces.find((w) => w.kind === "personal");
  return (
    <div className="view">
      <div className="panel">
        <div className="empty">
          <b>{t("bo.suspendedTitle")}</b>
          <span>{t("bo.suspendedText", { name: current.name })}</span>
          <span>{t("bo.suspendedAsk")}</span>
          <div className="row">
            <Link className="btn ghost" href="/app/support">{t("bo.suspendedContact")}</Link>
            {personal && <button type="button" className="btn" onClick={() => setCurrent(personal.id)}>{t("bo.suspendedGoPersonal")}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** For everybody else: the whole company is closed. */
export function ClosedPage() {
  const { current, workspaces, setCurrent } = useWs();
  const { t } = useI18n();
  const personal = workspaces.find((w) => w.kind === "personal");
  return (
    <div className="view">
      <div className="panel">
        <div className="empty">
          <b>{t("shell.closedTitle")}</b>
          <span>{t("shell.closedText", { name: current.name })}</span>
          <span>{t("shell.closedAsk")}</span>
          {personal && <button type="button" className="btn" onClick={() => setCurrent(personal.id)}>{t("shell.closedGoPersonal")}</button>}
        </div>
      </div>
    </div>
  );
}
