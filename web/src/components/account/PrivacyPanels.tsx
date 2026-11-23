"use client";

// Settings, Privacy and data: export my data, export the company, delete my account, delete the company.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { CANCELLED, useConfirmation, useReauth } from "./ReauthDialog";
import { Dialog, Weave, slot } from "@/components/ops/shared";
import { useSignOutGuard } from "@/components/app/SignOutGuard";
import { clearOfflineData } from "@/lib/pwa/store";
import { useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { ApiError, api } from "@/lib/api";
import { downloadExport, privacyApi, type DataRequest } from "@/lib/account-api";
import { googleErrorText } from "@/lib/google";
import { keys, useWorkspaceDetail } from "@/lib/hooks";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { DELETE_WORD, confirmMatches, daysUntil, exportState, formatDay, formatSize, latestExport, privacyErrorText, timeLeft } from "@/lib/privacy";

const REQUESTS_KEY = ["privacy-requests"] as const;

function useRequests() {
  return useQuery({
    queryKey: REQUESTS_KEY,
    queryFn: privacyApi.requests,
    // While a file is being prepared the screen keeps asking, so "preparing" turns into "ready" by itself.
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.kind === "export" && (r.status === "pending" || r.status === "processing")) ? 4000 : false),
  });
}

/** One export block: the button, then preparing, ready with its expiry, used, expired or failed. */
function ExportBlock({ workspaceId, title, intro, empty }: { workspaceId?: string; title: string; intro: string; empty: string }) {
  const { t, number } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const requests = useRequests();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const reauth = useReauth();
  const latest: DataRequest | undefined = latestExport(requests.data, workspaceId);
  const state = exportState(latest);

  async function start() {
    setErr("");
    setBusy(true);
    try {
      const r = await reauth.run((proof) => privacyApi.startExport(workspaceId, proof));
      if (r === CANCELLED) return;
      await qc.invalidateQueries({ queryKey: REQUESTS_KEY });
    } catch (e) {
      setErr(e instanceof ApiError ? privacyErrorText(e.code, apiErrorText(e, t), t) : t("settings.genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function download(id: string) {
    setErr("");
    try {
      const link = await reauth.run((proof) => privacyApi.downloadLink(id, proof));
      if (link === CANCELLED) return;
      const token = link.url.split("/data-download/")[1];
      await downloadExport(token);
      toast(t("settings.downloadStarted"));
      window.setTimeout(() => void qc.invalidateQueries({ queryKey: REQUESTS_KEY }), 2500);
    } catch (e) {
      setErr(apiErrorText(e, t, "settings.downloadFailed"));
    }
  }

  return (
    <section className="panel card" aria-labelledby={`exp-${workspaceId ?? "me"}`}>
      <div className="head"><h2 id={`exp-${workspaceId ?? "me"}`}><span className="chip"><Icon name="download" size="s" /></span>{title}</h2></div>
      <div className="hint">{intro}</div>
      {state === "preparing" && (
        <div className="notice" role="status"><Icon name="clock" /><div className="grow"><b>{t("settings.exportPreparing")}</b>{t("settings.exportPreparingText")}</div></div>
      )}
      {state === "ready" && latest && (
        <div className="notice" role="status">
          <Icon name="check" />
          <div className="grow">
            <b>{t("settings.exportReady")}</b>
            {t("settings.exportReadyText", { size: formatSize(latest.file_size, number), time: timeLeft(latest.expires_at, t) })}
            <div style={{ marginBlockStart: 8 }}><button type="button" className="btn sm" onClick={() => download(latest.id)}>{t("common.download")}</button></div>
          </div>
        </div>
      )}
      {state === "used" && <div className="hint">{t("settings.exportUsed")}</div>}
      {state === "expired" && <div className="hint">{t("settings.exportExpired")}</div>}
      {state === "failed" && <div className="notice bad" role="alert"><div className="grow"><b>{t("settings.exportFailed")}</b>{latest?.error ?? t("settings.tryAgain")}</div></div>}
      {state === "none" && <div className="hint">{empty}</div>}
      {err && <span className="err" role="alert">{err}</span>}
      {state !== "preparing" && state !== "ready" && <div><button type="button" className="btn" disabled={busy} onClick={start}>{busy ? t("settings.starting") : t("settings.exportButton")}</button></div>}
      {requests.error && <span className="err" role="alert">{t("settings.requestsFailed")}</span>}
      {reauth.dialog}
    </section>
  );
}

export function ExportPanels() {
  const { current, isCompany, role } = useWs();
  const { t } = useI18n();
  return (
    <>
      <ExportBlock
        title={t("settings.exportMineTitle")}
        intro={t("settings.exportMineIntro")}
        empty={t("settings.exportMineEmpty")}
      />
      {isCompany && role === "owner" && (
        <ExportBlock
          workspaceId={current.id}
          title={t("settings.exportCompanyTitle")}
          intro={t("settings.exportCompanyIntro", { name: current.name })}
          empty={t("settings.exportCompanyEmpty")}
        />
      )}
    </>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const confirmation = useConfirmation();
  const ok = confirmMatches(typed, DELETE_WORD) && confirmation.ready;
  const { guard, dialog: unsentDialog } = useSignOutGuard();

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      await privacyApi.deleteAccount({ confirm: typed.trim(), ...confirmation.proof });
      try {
        await api.logout();
      } finally {
        await clearOfflineData();
        qc.clear();
        window.location.assign("/login?deleted=1");
      }
    } catch (e) {
      setErr(e instanceof ApiError ? googleErrorText(e.code, apiErrorText(e, t), t) : t("settings.genericError"));
      confirmation.reset();
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("settings.delAccountTitle")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>{t("settings.delAccountKeep")}</button>
          <button type="button" className="btn danger" disabled={!ok || busy} onClick={() => guard(submit)}>{busy ? t("settings.deleting") : t("settings.delAccountTitle")}</button>
        </>
      }
    >
      {unsentDialog}
      <div className="notice warn" role="note">
        <Icon name="alert" />
        <div className="grow">
          <b>{t("settings.delAccountNotice")}</b>
          {t("settings.delAccountNoticeText")}
        </div>
      </div>
      <div className="hint">{t("settings.delAccountHint")}</div>
      {confirmation.field}
      <label>
        <Weave text={t("settings.typeToConfirm", { word: slot(0) })} nodes={[<b key="w" className="ltr">{DELETE_WORD}</b>]} />
        <input className="ltr" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} aria-label={t("settings.typeToConfirm", { word: DELETE_WORD })} />
      </label>
      {err && <span className="err" role="alert">{err}</span>}
    </Dialog>
  );
}

export function DeleteAccountPanel() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <section className="panel card" aria-labelledby="del-me">
      <div className="head"><h2 id="del-me"><span className="chip"><Icon name="trash" size="s" /></span>{t("settings.delAccountTitle")}</h2></div>
      <div className="hint">{t("settings.delAccountPanelHint")}</div>
      <div><button type="button" className="btn danger" onClick={() => setOpen(true)}>{t("settings.delAccountOpen")}</button></div>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </section>
  );
}

function DeleteCompanyDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const confirmation = useConfirmation();
  const ok = confirmMatches(typed, name) && confirmation.ready;

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      await privacyApi.deleteCompany(id, { confirm_name: typed.trim(), ...confirmation.proof });
      await qc.invalidateQueries({ queryKey: keys.workspace(id) });
      await qc.invalidateQueries({ queryKey: REQUESTS_KEY });
      toast(t("settings.delCompanyScheduled"));
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? googleErrorText(e.code, apiErrorText(e, t), t) : t("settings.genericError"));
      confirmation.reset();
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("settings.delCompanyTitle")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>{t("settings.delCompanyKeep")}</button>
          <button type="button" className="btn danger" disabled={!ok || busy} onClick={submit}>{busy ? t("settings.deleting") : t("settings.delCompanyButton")}</button>
        </>
      }
    >
      <div className="notice warn" role="note">
        <Icon name="alert" />
        <div className="grow">
          <b>{t("settings.delCompanyNotice")}</b>
          {t("settings.delCompanyNoticeText")}
        </div>
      </div>
      <div className="hint">{t("settings.delCompanyHint")}</div>
      <label>
        <Weave text={t("settings.typeCompanyName", { name: slot(0) })} nodes={[<b key="n" dir="auto">{name}</b>]} />
        <input dir="auto" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} aria-label={t("settings.typeCompanyNameAria")} />
      </label>
      {confirmation.field}
      {err && <span className="err" role="alert">{err}</span>}
    </Dialog>
  );
}

export function DeleteCompanyPanel() {
  const { current, isCompany, role } = useWs();
  const { t, date } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const detail = useWorkspaceDetail(isCompany ? current.id : "");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!isCompany || role !== "owner" || !detail.data) return null;

  const due = detail.data.deletion_due_at;
  return (
    <section className="panel card" aria-labelledby="del-co">
      <div className="head"><h2 id="del-co"><span className="chip"><Icon name="trash" size="s" /></span>{t("settings.delCompanyTitle")}</h2></div>
      {due ? (
        <>
          <div className="notice warn" role="status">
            <Icon name="clock" />
            <div className="grow">
              <b dir="auto">{t("settings.delCompanyDue", { name: detail.data.name })}</b>
              {t("settings.delCompanyDueText", { date: formatDay(due, date), days: daysUntil(due) })}
            </div>
          </div>
          {err && <span className="err" role="alert">{err}</span>}
          <div>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={async () => {
                setErr("");
                setBusy(true);
                try {
                  await privacyApi.restoreCompany(current.id);
                  await qc.invalidateQueries({ queryKey: keys.workspace(current.id) });
                  await qc.invalidateQueries({ queryKey: REQUESTS_KEY });
                  toast(t("settings.companyRestored"));
                } catch (e) {
                  setErr(apiErrorText(e, t, "settings.restoreFailed"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? t("settings.restoring") : t("settings.restoreCompany")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="hint">{t("settings.delCompanyPanelHint")}</div>
          <div><button type="button" className="btn danger" onClick={() => setOpen(true)}>{t("settings.delCompanyOpen")}</button></div>
        </>
      )}
      {open && <DeleteCompanyDialog id={current.id} name={detail.data.name} onClose={() => setOpen(false)} />}
    </section>
  );
}
