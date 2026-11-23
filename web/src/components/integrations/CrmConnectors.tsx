"use client";

import { useFlags } from "@/lib/flags";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import s from "@/components/crm/crm.module.css";
import { Dialog } from "@/components/ops/shared";
import { codeText, errorText, integrations, type CrmConnection, type CrmVendor } from "@/lib/integrations/api";
import { tk, type MessageKey } from "@/lib/i18n";
import { apiServerText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { copyText } from "@/lib/tools/clipboard";

const FIELD_TEXT: Record<string, MessageKey> = {
  first_name: tk("dev.fFirstName"), last_name: tk("dev.fLastName"), email: tk("dev.fEmail"), phone: tk("dev.fPhone"),
  company: tk("dev.fCompany"), message: tk("dev.fMessage"), source: tk("dev.fSource"), card_name: tk("dev.fCardName"),
};
const STATUS_TEXT: Record<string, MessageKey> = {
  new: tk("dev.stNew"), contacted: tk("dev.stContacted"), qualified: tk("dev.stQualified"), won: tk("dev.stWon"), lost: tk("dev.stLost"),
};
const HEALTH_TEXT: Record<CrmConnection["health"], MessageKey> = {
  ok: tk("dev.healthOk"), retrying: tk("dev.healthRetrying"), failing: tk("dev.healthFailing"), needs_reconnect: tk("dev.healthReconnect"),
};
const SETUP_TEXT: Record<string, MessageKey> = { hubspot: tk("dev.setupHubspot"), salesforce: tk("dev.setupSalesforce"), zoho: tk("dev.setupZoho") };

/** The CRM section, unless the product team switched CRM connections off for this company. */
export function CrmConnectors({ ws }: { ws: string }) {
  const flags = useFlags(ws);
  return flags.crm_connectors ? <CrmConnectorsInner ws={ws} /> : null;
}

function CrmConnectorsInner({ ws }: { ws: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["crm-connectors", ws], queryFn: () => integrations.crm(ws) });

  // The vendor sends the browser back here with the result of connecting.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const vendor = p.get("crm");
    if (!vendor) return;
    toast(p.get("crm_status") === "connected" ? t("dev.connectedToast", { vendor }) : codeText(p.get("crm_code") ?? "", t, t("dev.errGeneric")));
    window.history.replaceState(null, "", window.location.pathname);
    void qc.invalidateQueries({ queryKey: ["crm-connectors", ws] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="panel card">
      <div className="head"><h2><span className="chip accent"><Icon name="share" size="s" /></span>{t("dev.crm")}</h2></div>
      <p className="hint">{t("dev.crmHint")}</p>
      {q.isLoading ? <SkeletonBlocks rows={2} /> : q.error ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : (
        q.data?.vendors.map((v) => <VendorCard key={v.vendor} ws={ws} v={v} fields={q.data.lead_fields} statuses={q.data.statuses} refresh={() => void qc.invalidateQueries({ queryKey: ["crm-connectors", ws] })} />)
      )}
    </div>
  );
}

function VendorCard({ ws, v, fields, statuses, refresh }: { ws: string; v: CrmVendor; fields: string[]; statuses: string[]; refresh: () => void }) {
  const { t, date } = useI18n();
  const toast = useToast();
  const [region, setRegion] = useState(v.regions?.[0] ?? "");
  const [showSetup, setShowSetup] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const c = v.connection;
  const when = (iso: string | null) => (iso ? date(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

  const connect = useMutation({
    mutationFn: () => integrations.connect(ws, v.vendor, v.regions ? region : undefined),
    onSuccess: (r) => { window.location.href = r.authorize_url; },
    onError: (e) => toast(errorText(e, t)),
  });
  const disconnect = useMutation({
    mutationFn: () => integrations.disconnect(ws, v.vendor),
    onSuccess: () => { setLeaving(false); refresh(); toast(t("dev.disconnected")); },
    onError: (e) => toast(errorText(e, t)),
  });
  const test = useMutation({
    mutationFn: () => integrations.testLead(ws, v.vendor),
    onSuccess: (r) => { toast(r.ok ? t("dev.testOk") : t("dev.testFailed", { reason: codeText(r.code, t, apiServerText(r.detail, t, "dev.errGeneric")) })); refresh(); },
    onError: (e) => toast(errorText(e, t)),
  });
  const backfill = useMutation({
    mutationFn: () => integrations.backfill(ws, v.vendor),
    onSuccess: (r) => { toast(t("dev.backfillDone", { n: r.queued })); refresh(); },
    onError: (e) => toast(errorText(e, t)),
  });

  return (
    <div className={s.hook}>
      <div className={s.hookHead}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <div className={s.hookUrl}>{v.label}</div>
          {c && <div className="hint">{t("dev.account", { name: c.account })} · {c.last_success_at ? t("dev.lastSent", { when: when(c.last_success_at) }) : t("dev.nothingSent")}</div>}
        </div>
        {c && <span className={`pill ${c.health === "ok" ? "ok" : c.health === "retrying" ? "warn" : "bad"}`}>{t(HEALTH_TEXT[c.health])}</span>}
      </div>

      {!v.available && <p className="hint">{t("dev.crmNotAvailable")}</p>}
      {!c && v.available && (
        <div className="row">
          {v.regions && (
            <label>{t("dev.region")}
              <select value={region} onChange={(e) => setRegion(e.target.value)}>{v.regions.map((r) => <option key={r} value={r}>.{r}</option>)}</select>
              <span className="hint">{t("dev.regionHint")}</span>
            </label>
          )}
          <button type="button" className="btn sm" disabled={connect.isPending} onClick={() => connect.mutate()}>{connect.isPending ? t("dev.connecting") : t("dev.connect")}</button>
        </div>
      )}
      {c && c.last_error_code && (
        <div className="notice bad" role="alert"><Icon name="alert" /><div className="grow">
          {t("dev.lastProblem", { text: codeText(c.last_error_code, t, t("dev.errGeneric")) })}
          {c.last_error && c.last_error_code === "crm_rejected" && <div className="hint ltr">{t("dev.vendorSays", { detail: c.last_error })}</div>}
        </div></div>
      )}
      {c && c.status === "disabled" && v.available && (
        <div className="row">
          {v.regions && <select value={region || c.region} onChange={(e) => setRegion(e.target.value)}>{v.regions.map((r) => <option key={r} value={r}>.{r}</option>)}</select>}
          <button type="button" className="btn sm" disabled={connect.isPending} onClick={() => connect.mutate()}>{t("dev.connect")}</button>
        </div>
      )}
      {c && c.status === "connected" && (
        <>
          <span className="hint">{t("dev.waiting", { n: c.pending })}</span>
          <div className="row">
            <button type="button" className="btn sm" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? t("dev.sending") : t("dev.sendTest")}</button>
            <button type="button" className="btn ghost sm" disabled={backfill.isPending} onClick={() => backfill.mutate()}>{t("dev.backfill")}</button>
            <button type="button" className="btn danger sm" onClick={() => setLeaving(true)}>{t("dev.disconnect")}</button>
          </div>
          <span className="hint">{t("dev.backfillHint")}</span>
          <Settings ws={ws} v={v} c={c} fields={fields} statuses={statuses} refresh={refresh} />
          <Jobs ws={ws} vendor={v.vendor} />
        </>
      )}
      <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setShowSetup((x) => !x)}>{t("dev.setupTitle")}</button>
      {showSetup && (
        <div className="hint">
          <p>{t(SETUP_TEXT[v.vendor])}</p>
          <p>{t("dev.setupRedirect")}</p>
          <div className={s.secret}>
            <code className="ltr">{v.redirect_uri}</code>
            <button type="button" className="btn sm" onClick={async () => toast((await copyText(v.redirect_uri)) ? t("common.copied") : t("settings.copyFailed"))}>{t("common.copy")}</button>
          </div>
          <p>{t("dev.setupEnv")}</p>
        </div>
      )}
      {leaving && (
        <Dialog title={t("dev.disconnectTitle", { vendor: v.label })} onClose={() => setLeaving(false)} footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setLeaving(false)}>{t("common.cancel")}</button>
            <button type="button" className="btn" style={{ background: "var(--danger)", borderColor: "var(--danger)" }} disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>{t("dev.disconnect")}</button>
          </>
        }>
          <p>{t("dev.disconnectText")}</p>
        </Dialog>
      )}
    </div>
  );
}

function Settings({ ws, v, c, fields, statuses, refresh }: { ws: string; v: CrmVendor; c: CrmConnection; fields: string[]; statuses: string[]; refresh: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [mapping, setMapping] = useState<Record<string, string>>(c.mapping);
  const [settings, setSettings] = useState(c.settings);
  const [statusMap, setStatusMap] = useState<Record<string, string>>(c.status_map);
  const save = useMutation({
    mutationFn: () => integrations.saveCrm(ws, v.vendor, { mapping, settings: { ...settings, status_map: statusMap } }),
    onSuccess: () => { toast(t("dev.saved")); refresh(); },
    onError: (e) => toast(errorText(e, t)),
  });
  const flags: [keyof typeof settings, MessageKey][] = [
    ["sync_new_leads", tk("dev.ruleNew")], ["add_note", tk("dev.ruleNote")], ["assign_owner", tk("dev.ruleOwner")], ["sync_status", tk("dev.ruleStatus")],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <b>{t("dev.rules")}</b>
      {flags.map(([k, key]) => (
        <label className="chkrow" key={k}>
          <input type="checkbox" className="chk" checked={Boolean(settings[k])} onChange={(e) => setSettings({ ...settings, [k]: e.target.checked })} />
          <span>{t(key)}</span>
        </label>
      ))}
      <b>{t("dev.mapping")}</b>
      <span className="hint">{t("dev.mappingHint")}</span>
      {fields.map((f) => (
        <label key={f}>{FIELD_TEXT[f] ? t(FIELD_TEXT[f]) : f}
          <input className="ltr" value={mapping[f] ?? ""} placeholder={t("dev.fieldPh")} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })} />
        </label>
      ))}
      {settings.sync_status && (
        <>
          <b>{t("dev.statusValues")}</b>
          {statuses.map((st) => (
            <label key={st}>{STATUS_TEXT[st] ? t(STATUS_TEXT[st]) : st}
              <input className="ltr" value={statusMap[st] ?? ""} onChange={(e) => setStatusMap({ ...statusMap, [st]: e.target.value })} />
            </label>
          ))}
        </>
      )}
      <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} disabled={save.isPending} onClick={() => save.mutate()}>{t("dev.saveSettings")}</button>
    </div>
  );
}

function Jobs({ ws, vendor }: { ws: string; vendor: string }) {
  const { t, date } = useI18n();
  const q = useQuery({ queryKey: ["crm-jobs", ws, vendor], queryFn: () => integrations.jobs(ws, vendor), refetchInterval: 30_000 });
  const rows = q.data?.results ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <b>{t("dev.recent")}</b>
      {rows.length === 0 ? <span className="hint">{t("dev.noJobs")}</span> : rows.slice(0, 8).map((j) => (
        <div key={j.id} className="hint">
          <span className={`pill ${j.status === "success" ? "ok" : j.status === "pending" ? "warn" : "bad"}`}>{j.status === "success" ? t("dev.jobSent") : j.status === "pending" ? t("dev.jobWaiting") : t("dev.jobFailed")}</span>{" "}
          <bdi>{j.name}</bdi> · {date(j.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          {j.error_code ? ` · ${codeText(j.error_code, t, t("dev.errGeneric"))}` : ""}
        </div>
      ))}
    </div>
  );
}
