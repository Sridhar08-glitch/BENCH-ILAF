"use client";

import { EnterpriseGate } from "@/components/app/EnterpriseLock";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Avatar, Empty, ErrorBox, PageHead, SkeletonBlocks, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { ButtonListEditor } from "@/components/ops/ButtonListEditor";
import { ChangeView } from "@/components/ops/ChangeView";
import { Check, ResultsDialog, SelectionBar } from "@/components/ops/shared";
import s from "@/components/ops/ops.module.css";
import { ApiError, api } from "@/lib/api";
import { BUTTON_GROUPS } from "@/lib/card/buttons";
import { platformName } from "@/lib/card/catalogue";
import { keys, useChangeRequests, useFieldRules } from "@/lib/hooks";
import { tk, type MessageKey } from "@/lib/i18n";
import { apiErrorText, apiFirstFieldText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { allSelected, pruneSelection, selectAll, toggleId } from "@/lib/ops/bulk";
import { PERMISSIONS, PLAIN_FIELDS, changeSummary, parseDomains, permissionLabel, ruleChanges, rulesSummary, withRule } from "@/lib/ops/fields";
import { whenText } from "@/lib/ops/audit";
import { buttonsProblem } from "@/lib/ops/departments";
import type { BulkResult, ChangeRequest, FieldPermission, FieldRules, ItemKind } from "@/lib/types";

type Tab = "rules" | "approvals";
const ALL_KINDS: ItemKind[] = [...BUTTON_GROUPS.flatMap((g) => g.kinds), "Custom"];
const SETTING_ROWS: { key: "slug" | "features" | "vcard"; label: MessageKey }[] = [
  { key: "slug", label: tk("company.setSlug") },
  { key: "features", label: tk("company.setFeatures") },
  { key: "vcard", label: tk("company.setVcard") },
];

const BUTTON_ROWS: { key: "button_add" | "button_edit" | "button_remove"; label: MessageKey }[] = [
  { key: "button_add", label: tk("company.btnAdd") },
  { key: "button_edit", label: tk("company.btnEdit") },
  { key: "button_remove", label: tk("company.btnRemove") },
];
const STATUS_WORD: Record<string, MessageKey> = { approved: tk("company.statusApproved"), rejected: tk("company.statusRejected"), withdrawn: tk("company.statusWithdrawn") };

function FieldsPageContent() {
  const { current, isManager, isCompany } = useWs();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("rules");
  const pending = useChangeRequests(current.id, "pending", isManager && isCompany);

  useEffect(() => {
    // The waiting-changes email links here with ?tab=approvals.
    if (new URLSearchParams(window.location.search).get("tab") === "approvals") setTab("approvals");
  }, []);

  if (!isManager || !isCompany) {
    return (
      <div className="view">
        <PageHead title={t("company.fieldsTitle")} sub={t("company.fieldsSubShort")} />
        <div className="panel"><Empty title={t("company.fieldsManagersOnly")} action={<Link className="btn sm" href="/app/cards">{t("company.goToMyCard")}</Link>} /></div>
      </div>
    );
  }
  const waiting = pending.data?.pending_count ?? 0;
  return (
    <div className="view">
      <PageHead title={t("company.fieldsTitle")} sub={t("company.fieldsSub")} />
      <div className="panel card" style={{ paddingBlockEnd: 0 }}>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" className="tab" aria-selected={tab === "rules"} onClick={() => setTab("rules")}><Icon name="lock" size="s" />{t("company.tabRules")}</button>
          <button type="button" role="tab" className="tab" aria-selected={tab === "approvals"} onClick={() => setTab("approvals")}>
            <Icon name="check" size="s" />{t("company.tabApprovals")}{waiting > 0 && <span className="pill warn" style={{ marginInlineStart: 4 }}>{waiting}</span>}
          </button>
        </div>
      </div>
      {tab === "rules" ? <RulesTab wsId={current.id} /> : <ApprovalsTab wsId={current.id} />}
    </div>
  );
}

// ---------------------------------------------------------------- rules

function RulesTab({ wsId }: { wsId: string }) {
  const q = useFieldRules(wsId);
  if (q.isLoading) return <SkeletonBlocks rows={4} />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  return <RulesForm key={JSON.stringify(q.data)} wsId={wsId} saved={q.data} />;
}

function PermissionRow({ label, name, value, onChange, allowed }: { label: string; name: string; value: FieldPermission; onChange: (p: FieldPermission) => void; allowed?: FieldPermission[] }) {
  const { t } = useI18n();
  return (
    <div className={s.mrow} role="radiogroup" aria-label={label}>
      <b>{label}</b>
      {PERMISSIONS.map((p) => allowed && !allowed.includes(p.id) ? <div className={s.opt} key={p.id} aria-hidden="true" /> : (
        <div className={s.opt} key={p.id}>
          <label>
            <input type="radio" name={name} checked={value === p.id} onChange={() => onChange(p.id)} aria-label={t("company.permAria", { label, permission: permissionLabel(p.id, t) })} />
            <span className={s.optText}>{permissionLabel(p.id, t)}</span>
          </label>
        </div>
      ))}
    </div>
  );
}

function RulesForm({ wsId, saved }: { wsId: string; saved: FieldRules }) {
  const qc = useQueryClient();
  const toast = useToast();
  const i18n = useI18n();
  const { t } = i18n;
  const [draft, setDraft] = useState<FieldRules>(saved);
  const [domains, setDomains] = useState(saved.banned_domains.join("\n"));
  const [err, setErr] = useState<unknown>(null);
  const parsed = useMemo(() => parseDomains(domains), [domains]);
  const full = useMemo(() => ({ ...draft, banned_domains: parsed.domains }), [draft, parsed.domains]);
  const changes = ruleChanges(saved, full);
  const dirty = Object.keys(changes).length > 0;
  const mustProblem = buttonsProblem(draft.mandatory_buttons, t);
  const allKinds = draft.allowed_kinds === null;

  const save = useMutation({
    mutationFn: () => api.updateFieldRules(wsId, changes),
    onSuccess: (r) => {
      qc.setQueryData(keys.fieldRules(wsId), r);
      void qc.invalidateQueries({ queryKey: ["audit", wsId] });
      toast(t("company.rulesSaved"));
      setErr(null);
    },
    onError: setErr,
  });

  const toggleKind = (k: ItemKind) => {
    const cur = draft.allowed_kinds ?? ALL_KINDS;
    setDraft(withRule(draft, "allowed_kinds", cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  };

  return (
    <>
      <div className="notice" role="status">
        <Icon name="lock" />
        <div className="grow"><b>{rulesSummary(saved, i18n)}</b>{t("company.rulesNotice")}</div>
      </div>

      <section className="panel card" aria-label={t("company.profileFields")}>
        <div className="head"><h2><span className="chip"><Icon name="user" size="s" /></span>{t("company.profileFields")}</h2></div>
        <div className={s.matrix}>
          <div className={s.mrow + " " + s.h}><span>{t("company.colField")}</span>{PERMISSIONS.map((p) => <span key={p.id} style={{ textAlign: "center" }}>{t(p.label)}</span>)}</div>
          {PLAIN_FIELDS.map((f) => (
            <PermissionRow key={f.id} label={t(f.label)} name={f.id} value={draft[f.id]} onChange={(p) => setDraft(withRule(draft, f.id, p))} />
          ))}
        </div>
        <div className="hint">{t("company.approvalHint")}</div>
      </section>

      <section className="panel card" aria-label={t("company.settingsSection")}>
        <div className="head"><h2><span className="chip"><Icon name="lock" size="s" /></span>{t("company.settingsSection")}</h2></div>
        <div className={s.matrix}>
          <div className={s.mrow + " " + s.h}><span>{t("company.colField")}</span>{PERMISSIONS.map((p) => <span key={p.id} style={{ textAlign: "center" }}>{p.id === "approval" ? "" : t(p.label)}</span>)}</div>
          {SETTING_ROWS.map((r) => (
            <PermissionRow key={r.key} label={t(r.label)} name={r.key} value={draft[r.key] ?? "free"} allowed={["free", "locked"]} onChange={(p) => setDraft(withRule(draft, r.key, p))} />
          ))}
        </div>
        <div className="hint">{t("company.settingsHint")}</div>
      </section>

      <section className="panel card" aria-label={t("company.extrasSection")}>
        <div className="head"><h2><span className="chip"><Icon name="gem" size="s" /></span>{t("company.extrasSection")}</h2></div>
        <div className="hint">{t("company.extrasHint")}</div>
        <div><Link className="btn ghost sm" href="/app/brand">{t("company.extrasOpen")}</Link></div>
      </section>

      <section className="panel card" aria-label={t("company.buttonsSection")}>
        <div className="head"><h2><span className="chip"><Icon name="link" size="s" />
        </span>{t("company.buttonsSection")}</h2></div>
        <div className={s.matrix}>
          <div className={s.mrow + " " + s.h}><span>{t("company.colAction")}</span>{PERMISSIONS.map((p) => <span key={p.id} style={{ textAlign: "center" }}>{t(p.label)}</span>)}</div>
          {BUTTON_ROWS.map((r) => (
            <PermissionRow key={r.key} label={t(r.label)} name={r.key} value={draft[r.key]} onChange={(p) => setDraft(withRule(draft, r.key, p))} />
          ))}
        </div>

        <div className="pane">
          <div className="sechead">{t("company.whichKinds")}</div>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 10, fontWeight: 600, color: "var(--ink)" }}>
            <input type="checkbox" checked={allKinds} style={{ width: "auto" }} onChange={(e) => setDraft(withRule(draft, "allowed_kinds", e.target.checked ? null : [...ALL_KINDS]))} />
            {t("company.allKinds")}
          </label>
          {!allKinds && (
            <div className="chips" role="group" aria-label={t("company.allowedKindsAria")}>
              {ALL_KINDS.map((k) => (
                <button key={k} type="button" className="chipb" aria-pressed={draft.allowed_kinds?.includes(k) ?? false} onClick={() => toggleKind(k)}>{platformName(k, t)}</button>
              ))}
            </div>
          )}
        </div>

        <div className="pane">
          <div className="sechead">{t("company.bannedDomains")}</div>
          <label>
            {t("company.bannedHelp")}
            <textarea className="ltr" rows={3} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder={"competitor.com\nexample-shop.net"} aria-invalid={parsed.bad.length > 0} />
          </label>
          {parsed.bad.length > 0 && <span className="err" role="alert">{t("company.badDomains", { list: parsed.bad.slice(0, 4).join(", ") })}</span>}
        </div>

        <div className="pane">
          <div className="sechead">{t("company.requiredButtons")}</div>
          <p className="hint">{t("company.requiredHint")}</p>
          <ButtonListEditor items={draft.mandatory_buttons} onChange={(l) => setDraft(withRule(draft, "mandatory_buttons", l))} addLabel={t("company.addRequired")} empty={t("company.requiredEmpty")} idPrefix="req" />
          {mustProblem && <span className="err" role="alert">{mustProblem}</span>}
        </div>
      </section>

      {err !== null && err !== undefined && (err instanceof ApiError ? (
        <div className="notice bad" role="alert"><Icon name="alert" /><div className="grow"><b>{t("company.rulesNotSaved")}</b>{apiFirstFieldText(err, t)}</div></div>
      ) : <ErrorBox error={err} />)}
      <div className="row">
        <button type="button" className="btn" disabled={!dirty || save.isPending || parsed.bad.length > 0 || !!mustProblem} onClick={() => save.mutate()}>{save.isPending ? t("common.saving") : t("company.saveRules")}</button>
        {dirty && <button type="button" className="btn ghost" onClick={() => { setDraft(saved); setDomains(saved.banned_domains.join("\n")); }}>{t("company.undoChanges")}</button>}
        <span className="hint">{dirty ? t("company.unsaved") : t("company.allRulesSaved")}</span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- approvals

function ApprovalsTab({ wsId }: { wsId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const i18n = useI18n();
  const { t } = i18n;
  const [showDone, setShowDone] = useState(false);
  const pending = useChangeRequests(wsId, "pending");
  const history = useChangeRequests(wsId, "all", showDone);
  const [selected, setSelected] = useState<string[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [result, setResult] = useState<BulkResult | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const list = useMemo(() => pending.data?.results ?? [], [pending.data]);
  const ids = useMemo(() => list.map((c) => c.id), [list]);

  useEffect(() => {
    setSelected((sel) => {
      const next = pruneSelection(sel, ids);
      return next.length === sel.length ? sel : next;
    });
  }, [ids]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["changes", wsId] });
    void qc.invalidateQueries({ queryKey: ["audit", wsId] });
    void qc.invalidateQueries({ queryKey: ["cards", wsId] });
  };
  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean }) => api.decideChange(wsId, v.id, v.approve, reasons[v.id]),
    onSuccess: (_c, v) => {
      toast(v.approve ? t("company.approvedToast") : t("company.rejectedToast"));
      setErr(null);
      refresh();
    },
    onError: (e) => {
      setErr(e);
      refresh();
    },
  });
  const decideMany = useMutation({
    mutationFn: (v: { approve: boolean }) => api.decideChanges(wsId, selected, v.approve, reasons.bulk),
    onSuccess: (r) => {
      setResult(r);
      setSelected([]);
      setErr(null);
      refresh();
    },
    onError: setErr,
  });
  const decided = (history.data?.results ?? []).filter((c) => c.status !== "pending");

  return (
    <>
      {err !== null && err !== undefined && (err instanceof ApiError ? <div className="notice bad" role="alert"><Icon name="alert" /><div className="grow">{apiErrorText(err, t)}</div></div> : <ErrorBox error={err} />)}
      <section className="panel card" aria-label={t("company.waitingAria")}>
        <div className="head">
          <h2><span className="chip accent"><Icon name="clock" size="s" /></span>{list.length > 0 ? t("company.waitingTitleCount", { n: list.length }) : t("company.waitingTitle")}</h2>
        </div>
        {selected.length > 0 && (
          <SelectionBar count={selected.length} onClear={() => setSelected([])}>
            <input type="text" dir="auto" placeholder={t("company.reasonBulkPh")} aria-label={t("company.reasonBulkAria")} value={reasons.bulk ?? ""} onChange={(e) => setReasons({ ...reasons, bulk: e.target.value })} style={{ width: 240, background: "#fff" }} />
            <button type="button" className="btn sm" style={{ background: "var(--green)", borderColor: "var(--green)" }} disabled={decideMany.isPending} onClick={() => decideMany.mutate({ approve: true })}>{t("company.approveN", { n: selected.length })}</button>
            <button type="button" className="btn sm ghost danger" disabled={decideMany.isPending} onClick={() => decideMany.mutate({ approve: false })}>{t("company.rejectN", { n: selected.length })}</button>
          </SelectionBar>
        )}
        {pending.isLoading ? <SkeletonBlocks rows={2} /> : pending.error ? <ErrorBox error={pending.error} onRetry={() => void pending.refetch()} /> : list.length === 0 ? (
          <Empty title={t("company.nothingWaiting")}>{t("company.nothingWaitingText")}</Empty>
        ) : (
          <>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Check checked={allSelected(selected, ids)} indeterminate={selected.length > 0} label={t("company.selectAllAria")} onChange={(on) => setSelected(selectAll(ids, on))} />
              {t("company.selectAll")}
            </label>
            {list.map((c) => (
              <ChangeCard
                key={c.id}
                c={c}
                checked={selected.includes(c.id)}
                onCheck={() => setSelected((sel) => toggleId(sel, c.id))}
                reason={reasons[c.id] ?? ""}
                onReason={(v) => setReasons({ ...reasons, [c.id]: v })}
                busy={decide.isPending}
                onDecide={(approve) => decide.mutate({ id: c.id, approve })}
              />
            ))}
          </>
        )}
      </section>

      <div className="row">
        <button type="button" className="btn ghost sm" onClick={() => setShowDone((v) => !v)}>{showDone ? t("company.hideEarlier") : t("company.showEarlier")}</button>
      </div>
      {showDone && (
        <section className="panel card" aria-label={t("company.earlierDecisions")}>
          <div className="head"><h2>{t("company.earlierDecisions")}</h2></div>
          {history.isLoading ? <SkeletonBlocks rows={2} /> : decided.length === 0 ? (
            <Empty title={t("company.noDecisions")} />
          ) : (
            decided.map((c) => {
              const status = STATUS_WORD[c.status] ? t(STATUS_WORD[c.status]) : c.status;
              const line = [
                status,
                c.decided_by ? t("company.byWho", { name: c.decided_by.full_name || c.decided_by.email }) : "",
                c.decided_at ? whenText(c.decided_at, i18n) : "",
                c.reason ? t("company.reasonIs", { reason: c.reason }) : "",
              ].filter(Boolean).join(" · ");
              return (
                <div key={c.id} className="li">
                  <div className="t">
                    <b dir="auto">{c.card_name || t("company.cardFallback")}: {changeSummary(c, i18n)}</b>
                    <small dir="auto">{line}</small>
                  </div>
                  <span className={`pill ${c.status === "approved" ? "ok" : c.status === "rejected" ? "bad" : ""}`}>{status}</span>
                </div>
              );
            })
          )}
        </section>
      )}
      {result && <ResultsDialog result={result} onClose={() => setResult(null)} />}
    </>
  );
}

function ChangeCard({ c, checked, onCheck, reason, onReason, busy, onDecide }: {
  c: ChangeRequest;
  checked: boolean;
  onCheck: () => void;
  reason: string;
  onReason: (v: string) => void;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const who = c.requested_by?.full_name || c.requested_by?.email || t("company.anEmployee");
  return (
    <div className={s.change}>
      <div className={s.head}>
        <Check checked={checked} onChange={onCheck} label={t("company.selectChangeBy", { name: who })} />
        <Avatar name={who} />
        <div className={s.grow} style={{ flex: 1, minWidth: 0 }}>
          <b dir="auto">{who}</b>
          <div className="hint" dir="auto">{t("company.changeAsked", { summary: changeSummary(c, i18n), when: whenText(c.created_at, i18n) })}</div>
        </div>
        <Link className="btn ghost sm" href={`/app/cards/${c.card_id}`}>{t("company.openCard")}</Link>
      </div>
      <ChangeView change={c} />
      <div className={s.acts}>
        <input type="text" dir="auto" value={reason} maxLength={300} placeholder={t("company.reasonSentPh")} aria-label={t("company.reasonFor", { name: who })} onChange={(e) => onReason(e.target.value)} />
        <button type="button" className="btn sm" style={{ background: "var(--green)", borderColor: "var(--green)" }} disabled={busy} onClick={() => onDecide(true)}><Icon name="check" size="s" />{t("company.approve")}</button>
        <button type="button" className="btn ghost sm danger" disabled={busy} onClick={() => onDecide(false)}>{t("company.reject")}</button>
      </div>
    </div>
  );
}

export default function FieldsPage() {
  const { t } = useI18n();
  return <EnterpriseGate feature="field_rules" title={t("company.fieldsTitle")} sub={t("company.fieldsSubShort")}><FieldsPageContent /></EnterpriseGate>;
}
