"use client";

import { EnterpriseGate } from "@/components/app/EnterpriseLock";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Empty, ErrorBox, PageHead, SkeletonBlocks, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { EmptyState } from "@/components/guide/EmptyState";
import { TourButton } from "@/components/guide/TourButton";
import s from "@/components/crm/crm.module.css";
import { CrmConnectors } from "@/components/integrations/CrmConnectors";
import { Dialog, Weave, slot } from "@/components/ops/shared";
import { ApiError } from "@/lib/api";
import { crm } from "@/lib/crm/api";
import type { Delivery, Webhook, WebhookEvent } from "@/lib/crm/types";
import { EVENTS, HEADERS, SAMPLE_PAYLOAD, VERIFY_NODE, VERIFY_PYTHON } from "@/lib/crm/webhooks";
import { tk, type MessageKey, type TFunction } from "@/lib/i18n";
import { apiErrorText, apiFieldText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { copyText } from "@/lib/tools/clipboard";
import { useThrottleWait } from "@/lib/throttle-hook";

const EVENT_TEXT: Record<WebhookEvent, { name: MessageKey; text: MessageKey }> = {
  "lead.created": { name: tk("settings.evLeadCreated"), text: tk("settings.evLeadCreatedText") },
  "lead.updated": { name: tk("settings.evLeadUpdated"), text: tk("settings.evLeadUpdatedText") },
  "lead.assigned": { name: tk("settings.evLeadAssigned"), text: tk("settings.evLeadAssignedText") },
};

/** What each signing header means, matched by the end of its name. */
const HEADER_TEXT: [string, MessageKey][] = [
  ["Signature", tk("settings.hdrSignature")],
  ["Timestamp", tk("settings.hdrTimestamp")],
  ["Event-Id", tk("settings.hdrEventId")],
  ["Event", tk("settings.hdrEvent")],
];
const headerText = (name: string): MessageKey => HEADER_TEXT.find(([end]) => name.endsWith(`-${end}`))?.[1] ?? tk("settings.hdrEvent");

/** A quick check before the address goes to the server. The server does the real one. */
function urlProblem(url: string, t: TFunction): string | null {
  const v = url.trim();
  if (!v) return t("settings.urlEnter");
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return t("settings.urlFull");
  }
  if (u.protocol !== "https:") return t("settings.urlHttps");
  if (u.username || u.password) return t("settings.urlCredentials");
  return null;
}

/** The result of a send in a few words. */
function deliveryText(d: Delivery, t: TFunction): string {
  if (d.status === "success") return t("settings.delivered", { code: d.response_status ?? "" });
  if (d.status === "pending") return d.attempts ? t("settings.willRetry", { error: d.error || t("settings.failedWord") }) : t("settings.waitingSend");
  return d.error || t("settings.failedCode", { code: d.response_status ?? t("settings.noAnswer") });
}

function IntegrationsPageContent() {
  const { current, isManager, isCompany } = useWs();
  const { t, date } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<Webhook | "new" | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Webhook | null>(null);
  const [lang, setLang] = useState<"node" | "python">("node");
  const [needsPlan, setNeedsPlan] = useState(false);
  const wait = useThrottleWait();
  // A webhook needs a live company plan (402 subscription_required); other errors keep the message the API gave.
  const failed = (e: unknown, fallback: string) => {
    if (e instanceof ApiError && e.code === "subscription_required") {
      setNeedsPlan(true);
      toast(t("settings.webhookNeedsPlan"));
    } else toast(e instanceof ApiError ? apiErrorText(e, t) : fallback);
  };
  const list = useQuery({ queryKey: ["webhooks", current.id], queryFn: () => crm.webhooks(current.id), enabled: isManager && isCompany });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["webhooks", current.id] });
  const when = (iso: string | null) => (iso ? date(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : t("settings.never"));

  const toggle = useMutation({
    mutationFn: (w: Webhook) => crm.updateWebhook(current.id, w.id, { enabled: !w.enabled }),
    onSuccess: refresh,
    onError: (e) => failed(e, t("settings.couldNotChange")),
  });
  const remove = useMutation({
    mutationFn: (w: Webhook) => crm.deleteWebhook(current.id, w.id),
    onSuccess: () => { setRemoving(null); refresh(); toast(t("settings.webhookDeleted")); },
    onError: (e) => failed(e, t("settings.couldNotDelete")),
  });
  const rotate = useMutation({
    mutationFn: (w: Webhook) => crm.newSecret(current.id, w.id),
    onSuccess: (w) => { setSecret(w.secret ?? null); refresh(); },
    onError: (e) => failed(e, t("settings.couldNotSecret")),
  });
  const test = useMutation({
    mutationFn: (w: Webhook) => crm.testWebhook(current.id, w.id),
    onSuccess: (d, w) => {
      toast(d.status === "success" ? t("settings.testDelivered", { code: d.response_status ?? "" }) : t("settings.testFailed", { error: d.error || t("settings.noAnswer") }));
      void qc.invalidateQueries({ queryKey: ["deliveries", current.id, w.id] });
      setOpen(w.id);
    },
    onError: (e) => failed(e, t("settings.couldNotTest")),
  });

  if (!isCompany || !isManager) {
    return (
      <div className="view">
        <PageHead title={t("settings.intTitle")} sub={t("settings.intSubShort")} />
        <div className="panel card"><Empty title={isCompany ? t("settings.intOnlyManagers") : t("settings.intCompanyOnly")}>
          {isCompany ? t("settings.intAskOwner") : t("settings.intSwitch")}
        </Empty></div>
      </div>
    );
  }

  return (
    <div className="view">
      <PageHead title={t("settings.intTitle")} sub={t("settings.intSub")}>
        <TourButton />
        <Link className="btn ghost sm" href="/app/settings">{t("settings.backToSettings")}</Link>
        <button type="button" className="btn" data-guide="integrations-add" onClick={() => setForm("new")}><Icon name="plus" size="s" />{t("settings.addWebhook")}</button>
      </PageHead>

      <div className="panel card" data-guide="integrations-list">
        <div className="head"><h2><span className="chip"><Icon name="link" size="s" /></span>{t("settings.webhooks")}</h2></div>
        <p className="hint">{t("settings.webhookExplain")}</p>
        {needsPlan && (
          <div className="notice warn" role="alert">
            <Icon name="crown" />
            <div className="grow">
              <b>{t("settings.webhookNeedsPlanTitle")}</b>
              {t("settings.webhookNeedsPlan")}
              <div style={{ marginBlockStart: 8 }}><Link className="btn sm" href="/app/billing">{t("shell.seePlans")}</Link></div>
            </div>
          </div>
        )}
        {wait > 0 && <div className="notice warn" role="status" aria-live="polite"><div className="grow">{t("err.throttledNote", { n: wait })}</div></div>}
        {list.isLoading ? <SkeletonBlocks rows={2} /> : list.error ? <ErrorBox error={list.error} onRetry={() => void list.refetch()} /> : (list.data?.results.length ?? 0) === 0 ? (
          <EmptyState title={t("settings.noWebhooks")} helpSlug="integrations-and-webhooks" action={<button type="button" className="btn sm" onClick={() => setForm("new")}>{t("settings.addFirst")}</button>}>
            {t("settings.noWebhooksText")}
          </EmptyState>
        ) : (
          <div>
            {list.data?.results.map((w) => (
              <div className={s.hook} key={w.id}>
                <div className={s.hookHead}>
                  <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                    <div className={s.hookUrl}>{w.name ? <><bdi>{w.name}</bdi> · </> : null}<span className="ltr">{w.url}</span></div>
                    <div className="hint">{t("settings.secretLast", { hint: w.secret_hint, when: when(w.last_success_at) })}</div>
                  </div>
                  <span className={`pill ${w.enabled ? "ok" : w.disabled_reason ? "bad" : "warn"}`}>{w.enabled ? t("common.on") : w.disabled_reason ? t("settings.switchedOff") : t("common.off")}</span>
                </div>
                <div className="chips">{w.events.map((e) => <span key={e} className={s.pill2}>{EVENT_TEXT[e] ? t(EVENT_TEXT[e].name) : (EVENTS.find((x) => x.k === e)?.t ?? e)}</span>)}</div>
                {w.disabled_reason && <div className="notice bad" role="alert"><Icon name="alert" /><div className="grow"><b>{w.disabled_reason}</b>{t("settings.fixReceiver")}</div></div>}
                {w.enabled && w.consecutive_failures > 0 && <span className="hint">{t("settings.failedInRow", { n: w.consecutive_failures })}</span>}
                <div className="row">
                  <button type="button" className="btn sm" disabled={test.isPending || wait > 0} onClick={() => test.mutate(w)}>{test.isPending && test.variables?.id === w.id ? t("settings.sending") : t("settings.sendTest")}</button>
                  <button type="button" className="btn ghost sm" onClick={() => setOpen(open === w.id ? null : w.id)}>{open === w.id ? t("settings.hideLog") : t("settings.deliveryLog")}</button>
                  <button type="button" className="btn ghost sm" disabled={toggle.isPending} onClick={() => toggle.mutate(w)}>{w.enabled ? t("settings.switchOff") : t("settings.switchOn")}</button>
                  <button type="button" className="btn ghost sm" onClick={() => setForm(w)}>{t("common.edit")}</button>
                  <button type="button" className="btn ghost sm" disabled={rotate.isPending} onClick={() => rotate.mutate(w)}>{t("settings.newSecret")}</button>
                  <button type="button" className="btn danger sm" onClick={() => setRemoving(w)}>{t("common.delete")}</button>
                </div>
                {open === w.id && <DeliveryLog ws={current.id} id={w.id} />}
              </div>
            ))}
          </div>
        )}
      </div>

      <CrmConnectors ws={current.id} />

      <div className="g2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
        <div className="panel card" data-guide="integrations-connect">
          <div className="head"><h2><span className="chip accent"><Icon name="share" size="s" /></span>{t("settings.connectZapier")}</h2></div>
          <ol style={{ margin: 0, paddingInlineStart: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            <li><Weave text={t("settings.zap1", { hook: slot(0), catch: slot(1), custom: slot(2) })} nodes={[<b key="a">Webhooks by Zapier</b>, <b key="b">Catch Hook</b>, <b key="c">Custom webhook</b>]} /></li>
            <li>{t("settings.zap2")}</li>
            <li><Weave text={t("settings.zap3", { add: slot(0) })} nodes={[<b key="a">{t("settings.addWebhook")}</b>]} /></li>
            <li><Weave text={t("settings.zap4", { test: slot(0) })} nodes={[<b key="a">{t("settings.sendTest")}</b>]} /></li>
          </ol>
          <p className="hint">{t("settings.zapNoSignature")}</p>
          <p className="hint">{t("settings.zapTiming")}</p>
        </div>
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="lock" size="s" /></span>{t("settings.devTitle")}</h2></div>
          <div className={s.sec}>
            {HEADERS.map((h) => <div key={h.name}><b className="mono ltr" style={{ color: "var(--ink)" }}>{h.name}</b><div className="hint">{t(headerText(h.name))}</div></div>)}
          </div>
          <div className="seg" role="group" aria-label={t("settings.exampleLanguage")} style={{ alignSelf: "flex-start" }}>
            <button type="button" aria-pressed={lang === "node"} onClick={() => setLang("node")}>Node.js</button>
            <button type="button" aria-pressed={lang === "python"} onClick={() => setLang("python")}>Python</button>
          </div>
          <pre className={`${s.code} ltr`} tabIndex={0} aria-label={t("settings.signatureExample")}>{lang === "node" ? VERIFY_NODE : VERIFY_PYTHON}</pre>
        </div>
      </div>

      <div className="panel card">
        <div className="head"><h2><span className="chip ok"><Icon name="copy" size="s" /></span>{t("settings.sampleTitle")}</h2><button type="button" className="btn ghost sm" onClick={async () => toast((await copyText(SAMPLE_PAYLOAD)) ? t("common.copied") : t("settings.copyFailed"))}>{t("common.copy")}</button></div>
        <p className="hint">
          <Weave
            text={t("settings.sampleText", { created: slot(0), updated: slot(1), changes: slot(2), assigned: slot(3), previous: slot(4) })}
            nodes={[<b key="a" className="ltr">lead.created</b>, <b key="b" className="ltr">lead.updated</b>, <code key="c">changes</code>, <b key="d" className="ltr">lead.assigned</b>, <code key="e">previous_assignee</code>]}
          />
        </p>
        <pre className={`${s.code} ltr`} tabIndex={0} aria-label={t("settings.sampleAria")}>{SAMPLE_PAYLOAD}</pre>
      </div>

      {form && (
        <WebhookDialog
          ws={current.id}
          webhook={form === "new" ? null : form}
          onClose={() => setForm(null)}
          onSaved={(w, created) => {
            setForm(null);
            refresh();
            if (created) setSecret(w.secret ?? null);
          }}
        />
      )}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
      {removing && (
        <Dialog title={t("settings.deleteWebhookTitle")} onClose={() => setRemoving(null)} footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setRemoving(null)}>{t("common.cancel")}</button>
            <button type="button" className="btn" style={{ background: "var(--danger)", borderColor: "var(--danger)" }} disabled={remove.isPending} onClick={() => remove.mutate(removing)}>{t("common.delete")}</button>
          </>
        }>
          <p><Weave text={t("settings.deleteWebhookText", { url: slot(0) })} nodes={[<span key="u" className="ltr">{removing.url}</span>]} /></p>
        </Dialog>
      )}
    </div>
  );
}

function DeliveryLog({ ws, id }: { ws: string; id: string }) {
  const { t, date } = useI18n();
  const q = useQuery({ queryKey: ["deliveries", ws, id], queryFn: () => crm.deliveries(ws, id), refetchInterval: 15_000 });
  if (q.isLoading) return <SkeletonBlocks rows={2} />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data?.results ?? [];
  if (rows.length === 0) return <p className="hint">{t("settings.nothingSent")}</p>;
  const when = (iso: string) => date(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div role="table" aria-label={t("settings.deliveryLog")}>
      <div className={`${s.dl} ${s.h}`} role="row"><span>{t("settings.colResult")}</span><span className={s.hideSm}>{t("settings.colEvent")}</span><span className={s.hideSm}>{t("settings.colTries")}</span><span>{t("settings.colWhen")}</span></div>
      {rows.map((d) => (
        <div className={s.dl} role="row" key={d.id}>
          <span style={{ overflowWrap: "anywhere" }}><span className={`pill ${d.status === "success" ? "ok" : d.status === "pending" ? "warn" : "bad"}`}>{d.status === "success" ? t("settings.resOk") : d.status === "pending" ? t("settings.resRetry") : t("settings.resFailed")}</span> {deliveryText(d, t)}{d.is_test ? ` ${t("settings.testTag")}` : ""}</span>
          <span className={`${s.hideSm} ltr`}>{d.event_type}</span>
          <span className={s.hideSm}>{d.attempts}</span>
          <span className="hint">{d.duration_ms !== null ? t("settings.whenDuration", { when: when(d.created_at), ms: d.duration_ms }) : when(d.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

function WebhookDialog({ ws, webhook, onClose, onSaved }: { ws: string; webhook: Webhook | null; onClose: () => void; onSaved: (w: Webhook, created: boolean) => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState(webhook?.url ?? "");
  const [name, setName] = useState(webhook?.name ?? "");
  const [events, setEvents] = useState<WebhookEvent[]>(webhook?.events ?? ["lead.created", "lead.updated", "lead.assigned"]);
  const [err, setErr] = useState("");
  const save = useMutation({
    mutationFn: () => (webhook ? crm.updateWebhook(ws, webhook.id, { url: url.trim(), name, events }) : crm.createWebhook(ws, { url: url.trim(), name, events })),
    onSuccess: (w) => onSaved(w, !webhook),
    onError: (e) => setErr(e instanceof ApiError ? (e.code === "subscription_required" ? t("settings.webhookNeedsPlan") : (apiFieldText(e, "url", t) ?? apiFieldText(e, "events", t) ?? apiErrorText(e, t))) : t("settings.saveFailed")),
  });
  const problem = urlProblem(url, t);
  return (
    <Dialog
      title={webhook ? t("settings.editWebhook") : t("settings.addWebhook")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="btn" disabled={save.isPending || !!problem || events.length === 0} onClick={() => { setErr(""); save.mutate(); }}>{save.isPending ? t("common.saving") : webhook ? t("common.save") : t("settings.addWebhook")}</button>
        </>
      }
    >
      <label>{t("settings.webhookAddress")}
        <input className="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/123/abc" autoComplete="off" inputMode="url" aria-invalid={!!err || (!!url && !!problem)} />
        {url && problem && <span className="err">{problem}</span>}
      </label>
      <label>{t("settings.webhookName")}<input dir="auto" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("settings.webhookNamePh")} /></label>
      <div className="evChecks" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <b style={{ fontSize: 12, color: "var(--mute)" }}>{t("settings.sendMe")}</b>
        {EVENTS.map((e) => (
          <label className="chkrow" key={e.k}>
            <input type="checkbox" className="chk" checked={events.includes(e.k)} onChange={(x) => setEvents((c) => (x.target.checked ? [...c, e.k] : c.filter((k) => k !== e.k)))} />
            <span><b style={{ color: "var(--ink)" }}>{t(EVENT_TEXT[e.k].name)}</b> <span style={{ fontWeight: 400 }}>{t(EVENT_TEXT[e.k].text)}</span></span>
          </label>
        ))}
      </div>
      {err && <span className="err" role="alert">{err}</span>}
      <p className="hint">{t("settings.webhookPublic")}</p>
    </Dialog>
  );
}

function SecretDialog({ secret, onClose }: { secret: string; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <Dialog title={t("settings.secretTitle")} onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>{t("settings.secretSaved")}</button>}>
      <div className="notice warn"><Icon name="alert" /><div className="grow"><b>{t("settings.secretOnce")}</b>{t("settings.secretOnceText")}</div></div>
      <div className={s.secret}>
        <code className="ltr">{secret}</code>
        <button type="button" className="btn sm" onClick={async () => toast((await copyText(secret)) ? t("settings.secretCopied") : t("settings.secretCopyFailed"))}>{t("common.copy")}</button>
      </div>
      <p className="hint"><Weave text={t("settings.secretUse", { header: slot(0) })} nodes={[<span key="h" className="ltr">{HEADERS[0].name}</span>]} /></p>
    </Dialog>
  );
}

export default function IntegrationsPage() {
  const { t } = useI18n();
  return <EnterpriseGate feature="integrations" title={t("settings.intTitle")}><IntegrationsPageContent /></EnterpriseGate>;
}
