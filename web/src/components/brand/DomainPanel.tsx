"use client";

// The company's own web address (Enterprise): add a domain, see the DNS records to publish with copy buttons, check them now, remove.
// It saves by itself (it is not part of the brand's Save button) and shows the claim exactly as the API holds it.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { EnterpriseLock } from "@/components/app/EnterpriseLock";
import { ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import { ApiError, api } from "@/lib/api";
import { daysLeft, domainProblem, needsApexHelp, nextStep, reasonKey, recordRows, statusInfo, tidyDomain } from "@/lib/domains/panel";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { keys } from "@/lib/hooks";
import type { CustomDomainInfo, DnsRecord } from "@/lib/types";
import s from "./DomainPanel.module.css";

const domainKey = (ws: string) => ["domain", ws] as const;

export function DomainPanel({ wsId, allowed, initial }: { wsId: string; allowed: boolean; initial?: CustomDomainInfo | null }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: domainKey(wsId),
    queryFn: async () => (await api.domain(wsId)).domain,
    initialData: initial === undefined ? undefined : initial,
  });
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  // What changed: the claim itself, and (once verified or removed) the addresses of every card and the workspace's own field.
  const refresh = (info: CustomDomainInfo | null) => {
    qc.setQueryData(domainKey(wsId), info);
    void qc.invalidateQueries({ queryKey: keys.workspace(wsId) });
    void qc.invalidateQueries({ queryKey: keys.cards(wsId) });
    void qc.invalidateQueries({ queryKey: ["audit", wsId] });
  };

  const add = useMutation({
    mutationFn: (domain: string) => api.setDomain(wsId, domain),
    onSuccess: (r) => { refresh(r.domain); setText(""); setTried(false); setErr(null); toast(t("brand.domAdded")); },
    onError: setErr,
  });
  const check = useMutation({
    mutationFn: () => api.checkDomain(wsId),
    onSuccess: (r) => {
      refresh(r.domain);
      setErr(null);
      if (r.result.ok) toast(t("brand.domVerifiedToast"));
      else {
        const key = reasonKey(r.result.reason);
        toast(t("brand.domStillWaiting", { reason: key ? t(key) : "" }));
      }
    },
    onError: setErr,
  });
  const remove = useMutation({
    mutationFn: () => api.removeDomain(wsId),
    onSuccess: () => { refresh(null); setErr(null); toast(t("brand.domRemoved")); },
    onError: setErr,
  });

  if (q.isLoading) return <SkeletonBlocks rows={2} />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const info = q.data ?? null;
  const problem = tried ? domainProblem(text) : null;
  const busy = add.isPending || check.isPending || remove.isPending;
  const errorText = err ? apiErrorText(err, t) : null;
  const fieldError = problem ? t(problem) : err instanceof ApiError && err.code === "invalid_domain" ? errorText : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    const value = tidyDomain(text);
    setText(value);
    if (domainProblem(value)) return;
    add.mutate(value);
  }

  return (
    <div className={s.panel} data-testid="domain-panel">
      <div>
        <h3 className={s.title}><Icon name="globe" size="s" /> {t("brand.domTitle")}</h3>
        <p className="hint">{t("brand.domIntro")}</p>
      </div>

      {!allowed && <EnterpriseLock compact />}

      {allowed && !info && (
        <form onSubmit={submit} noValidate className={s.form}>
          <label>
            {t("brand.domLabel")}
            <input
              className="ltr" dir="ltr" value={text} placeholder="cards.company.com" autoComplete="off" autoCapitalize="none" spellCheck={false}
              onChange={(e) => setText(e.target.value)} aria-invalid={!!fieldError} aria-describedby="dom-hint" disabled={busy}
            />
          </label>
          <div id="dom-hint" className={fieldError ? "err" : "hint"} role={fieldError ? "alert" : undefined}>{fieldError ?? t("brand.domTypeHelp")}</div>
          {errorText && !fieldError && <div className="notice bad" role="alert">{errorText}</div>}
          <div><button className="btn" type="submit" disabled={busy}>{add.isPending ? t("brand.domAdding") : t("brand.domAdd")}</button></div>
        </form>
      )}

      {info && (
        <Claim
          info={info} busy={busy} checking={check.isPending} canCheck={allowed} error={errorText}
          onCheck={() => check.mutate()}
          onRemove={() => { if (window.confirm(t("brand.domRemoveConfirm", { domain: info.domain }))) remove.mutate(); }}
        />
      )}

      <details className={s.help}>
        <summary>{t("brand.domHelpTitle")}</summary>
        <ul>
          <li>{t("brand.domHelp1")}</li>
          <li>{t("brand.domHelp2")}</li>
          <li>{t("brand.domHelp3")}</li>
          <li>{t("brand.domHelp4")}</li>
        </ul>
      </details>
    </div>
  );
}

function Claim({ info, busy, checking, canCheck, error, onCheck, onRemove }: {
  info: CustomDomainInfo; busy: boolean; checking: boolean; canCheck: boolean; error: string | null; onCheck: () => void; onRemove: () => void;
}) {
  const { t, relative, number } = useI18n();
  const st = statusInfo(info.status);
  const step = nextStep(info);
  const why = reasonKey(info.last_error);
  const showRecords = info.status !== "verified" || !!info.last_error;
  const rows = recordRows(info);
  const apex = needsApexHelp(info);
  return (
    <div className={s.claim}>
      <div className={s.head}>
        <b className="ltr mono" dir="ltr" style={{ color: "var(--ink)" }}>{info.domain}</b>
        <span className={`${s.badge} ${s[st.tone]}`} role="status">{t(st.label)}</span>
      </div>

      {step === "done" && !info.last_error && <div className="notice" role="status"><Icon name="check" /><div className="grow">{t("brand.domVerifiedText", { url: info.url })}</div></div>}
      {step === "repair" && <div className="notice bad" role="status"><Icon name="alert" /><div className="grow">{t("brand.domBrokenText", { n: number(daysLeft(info.grace_ends_at)) })}</div></div>}
      {step === "retry" && <div className="notice warn" role="status"><Icon name="alert" /><div className="grow">{t("brand.domExpiredText")}</div></div>}
      {(step === "add_records" || step === "fix" || step === "wait") && info.expires_at && (
        <p className="hint">{t("brand.domPendingText", { n: number(daysLeft(info.expires_at)) })}</p>
      )}
      {why && <div className="notice warn" role="status"><Icon name="alert" /><div className="grow">{t(why)}</div></div>}

      {showRecords && (
        <div className={s.records}>
          <h4 className={s.sub}>{t("brand.domRecordsTitle")}</h4>
          <p className="hint">{t("brand.domRecordsHint")}</p>
          {apex && (
            <div className="notice" role="note"><Icon name="alert" /><div className="grow"><b>{t("brand.domApexTitle")}</b>{rows.some((r) => r.id === "a") ? t("brand.domApexA") : t("brand.domApexNo")}</div></div>
          )}
          <div className={s.table} role="table" aria-label={t("brand.domRecordsTitle")}>
            <div className={`${s.tr} ${s.th}`} role="row">
              <span role="columnheader">{t("brand.domColType")}</span>
              <span role="columnheader">{t("brand.domColName")}</span>
              <span role="columnheader">{t("brand.domColValue")}</span>
            </div>
            {rows.map((r, i) => (
              <div className={s.tr} role="row" key={`${r.id}-${i}`}>
                <span role="cell" className={s.type}><b>{r.record.type}</b><small>{t(r.what)}</small></span>
                <CopyCell label={t("brand.domColName")} value={r.record.name} />
                <CopyCell label={t("brand.domColValue")} value={r.record.value} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="row">
        {canCheck && (
          <button type="button" className="btn" onClick={onCheck} disabled={busy}>{checking ? t("brand.domChecking") : t("brand.domCheck")}</button>
        )}
        <button type="button" className="btn ghost danger" onClick={onRemove} disabled={busy}>{t("brand.domRemove")}</button>
        <small className="hint">{info.last_checked_at ? t("brand.domLastChecked", { when: relative(info.last_checked_at) }) : t("brand.domNeverChecked")}</small>
      </div>
      {error && <div className="notice bad" role="alert">{error}</div>}
    </div>
  );
}

function CopyCell({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      toast(t("brand.domCopied"));
      window.setTimeout(() => setDone(false), 1800);
    } catch {
      toast(t("brand.domCopyFailed"));
    }
  }
  return (
    <span role="cell" className={s.copy}>
      <code className="ltr" dir="ltr" aria-label={label}>{value}</code>
      <button type="button" className="btn ghost sm" onClick={() => void copy()} aria-label={`${t("brand.domCopy")}: ${label}`}>
        <Icon name={done ? "check" : "copy"} size="s" />{done ? t("brand.domCopied") : t("brand.domCopy")}
      </button>
    </span>
  );
}

export type { DnsRecord };
