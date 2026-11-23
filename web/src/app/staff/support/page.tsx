"use client";

// The support inbox: tabs (mine, unassigned, all open, solved), filters, search, SLA timers, and bulk actions.
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import { PriorityPill, SlaChip, StatusPill, SupportTabs, useNow } from "@/components/staff-support/parts";
import { staffApi } from "@/lib/designs/api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { staffSupportApi, type InboxQuery } from "@/lib/support/api";
import { ST } from "@/lib/support/staff-text";
import { CATEGORIES, PRIORITIES, STATUSES } from "@/lib/support/types";

const TABS = [
  { key: "mine", label: ST.tabMine },
  { key: "unassigned", label: ST.tabUnassigned },
  { key: "open", label: ST.tabOpen },
  { key: "solved", label: ST.tabSolved },
] as const;

export default function InboxPage() {
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const now = useNow();
  const me = useQuery({ queryKey: ["staff-me"], queryFn: staffApi.me });
  const canWrite = me.data?.staff_role === "support" || me.data?.staff_role === "admin";
  const [q, setQ] = useState<InboxQuery>({ tab: "open" });
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  const list = useQuery({ queryKey: ["staff-inbox", q], queryFn: () => staffSupportApi.inbox(q), placeholderData: (p) => p, refetchInterval: 30_000 });
  const set = (patch: InboxQuery) => { setQ((x) => ({ ...x, ...patch, page: patch.page ?? 1 })); setPicked([]); };

  async function bulk(action: string, value?: string) {
    setProblem("");
    try {
      const r = await staffSupportApi.bulk(picked, action, value);
      toast(ST.bulkDone(r.changed));
      setPicked([]);
      await qc.invalidateQueries({ queryKey: ["staff-inbox"] });
    } catch (e) {
      setProblem(apiErrorText(e, t));
    }
  }

  async function exportCsv() {
    try {
      const csv = await staffSupportApi.exportCsv(q);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "support-requests.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast(ST.exportDone);
    } catch (e) {
      setProblem(apiErrorText(e, t));
    }
  }

  const d = list.data;
  return (
    <div className="view">
      <h1>{ST.inbox}</h1>
      <SupportTabs />
      <div className="row" role="tablist" aria-label={ST.inbox} style={{ flexWrap: "wrap" }}>
        {TABS.map((tab) => {
          const n = tab.key === "mine" ? d?.counts.mine : tab.key === "unassigned" ? d?.counts.unassigned : tab.key === "open" ? d?.counts.open : undefined;
          return <button key={tab.key} type="button" role="tab" aria-selected={q.tab === tab.key} className={`btn sm ${q.tab === tab.key ? "" : "ghost"}`} onClick={() => set({ tab: tab.key })}>{tab.label}{n !== undefined ? ` (${n})` : ""}</button>;
        })}
      </div>
      <form className="row" style={{ flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); set({ q: text }); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={ST.search} aria-label={ST.search} style={{ minWidth: 260 }} />
        <select aria-label={ST.colStatus} value={q.status ?? ""} onChange={(e) => set({ status: e.target.value })}>
          <option value="">{ST.anyStatus}</option>{STATUSES.map((s) => <option key={s} value={s}>{ST.statuses[s]}</option>)}
        </select>
        <select aria-label={ST.colPriority} value={q.priority ?? ""} onChange={(e) => set({ priority: e.target.value })}>
          <option value="">{ST.anyPriority}</option>{PRIORITIES.map((s) => <option key={s} value={s}>{ST.priorities[s]}</option>)}
        </select>
        <select aria-label={ST.colCategory} value={q.category ?? ""} onChange={(e) => set({ category: e.target.value })}>
          <option value="">{ST.anyCategory}</option>{CATEGORIES.map((s) => <option key={s} value={s}>{ST.categories[s]}</option>)}
        </select>
        <select aria-label={ST.colChannel} value={q.channel ?? ""} onChange={(e) => set({ channel: e.target.value })}>
          <option value="">{ST.anyChannel}</option>{(["form", "chat", "email"] as const).map((s) => <option key={s} value={s}>{ST.channels[s]}</option>)}
        </select>
        <select aria-label={ST.colAssignee} value={q.assignee ?? ""} onChange={(e) => set({ assignee: e.target.value })}>
          <option value="">{ST.anyAssignee}</option><option value="none">{ST.unassigned}</option>
          {(d?.agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select aria-label={ST.colSla} value={q.sla ?? ""} onChange={(e) => set({ sla: e.target.value })}>
          <option value="">{ST.anySla}</option>{(Object.keys(ST.sla_states) as (keyof typeof ST.sla_states)[]).map((s) => <option key={s} value={s}>{ST.sla_states[s]}</option>)}
        </select>
        <input type="date" aria-label={ST.from} value={q.from ?? ""} onChange={(e) => set({ from: e.target.value })} />
        <input type="date" aria-label={ST.to} value={q.to ?? ""} onChange={(e) => set({ to: e.target.value })} />
        <input aria-label={ST.company} placeholder={ST.company} value={q.workspace ?? ""} onChange={(e) => set({ workspace: e.target.value.trim() })} style={{ width: 150 }} />
        <button className="btn sm">{ST.navInbox}</button>
        <button type="button" className="btn ghost sm" onClick={() => { setQ({ tab: q.tab }); setText(""); }}>{ST.clear}</button>
        {canWrite && <button type="button" className="btn ghost sm" onClick={() => void exportCsv()}>{ST.export}</button>}
      </form>
      {problem && <div className="notice bad" role="alert"><div className="grow">{problem}</div></div>}
      {canWrite && picked.length > 0 && (
        <div className="panel row" style={{ padding: 10, flexWrap: "wrap" }} role="group" aria-label={ST.selected(picked.length)}>
          <b>{ST.selected(picked.length)}</b>
          <select aria-label={ST.assignTo} defaultValue="" onChange={(e) => { if (e.target.value) void bulk("assign", e.target.value === "none" ? "" : e.target.value); e.target.value = ""; }}>
            <option value="">{ST.assignTo}</option><option value="none">{ST.unassigned}</option>
            {(d?.agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select aria-label={ST.setStatus} defaultValue="" onChange={(e) => { if (e.target.value) void bulk("status", e.target.value); e.target.value = ""; }}>
            <option value="">{ST.setStatus}</option>{STATUSES.map((s) => <option key={s} value={s}>{ST.statuses[s]}</option>)}
          </select>
          <select aria-label={ST.setPriority} defaultValue="" onChange={(e) => { if (e.target.value) void bulk("priority", e.target.value); e.target.value = ""; }}>
            <option value="">{ST.setPriority}</option>{PRIORITIES.map((s) => <option key={s} value={s}>{ST.priorities[s]}</option>)}
          </select>
          <button type="button" className="btn ghost sm" disabled={picked.length < 2} title={picked.length < 2 ? ST.mergeNeedTwo : undefined} onClick={() => void bulk("merge")}>{ST.merge}</button>
        </div>
      )}
      {list.isLoading && <SkeletonBlocks rows={4} />}
      {list.error && !d && <ErrorBox error={list.error} onRetry={() => void list.refetch()} />}
      {d && (
        <div className="panel" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {canWrite && <th style={{ padding: 10, width: 32 }}><input type="checkbox" aria-label={ST.selected(d.results.length)} checked={picked.length === d.results.length && d.results.length > 0} onChange={(e) => setPicked(e.target.checked ? d.results.map((r) => r.id) : [])} /></th>}
                {[ST.colNumber, ST.colSubject, ST.colStatus, ST.colPriority, ST.colCategory, ST.colChannel, ST.colAssignee, ST.colSla, ST.colActivity].map((h) => <th key={h} style={{ textAlign: "start", padding: 10, whiteSpace: "nowrap" }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.results.length === 0 && <tr><td colSpan={10} style={{ padding: 16 }} className="hint">{ST.empty}</td></tr>}
              {d.results.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                  {canWrite && <td style={{ padding: 10 }}><input type="checkbox" aria-label={r.label} checked={picked.includes(r.id)} onChange={(e) => setPicked((l) => (e.target.checked ? [...l, r.id] : l.filter((x) => x !== r.id)))} /></td>}
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}><Link href={`/staff/support/${r.id}`}>{r.label}</Link></td>
                  <td style={{ padding: 10, maxWidth: 360 }}>
                    <Link href={`/staff/support/${r.id}`} dir="auto" style={{ fontWeight: 700 }}>{r.subject}</Link>
                    <div className="hint" dir="auto">{r.requester_name || r.requester_email}{r.workspace_name ? ` · ${r.workspace_name}` : ""}</div>
                  </td>
                  <td style={{ padding: 10 }}><StatusPill status={r.status} /></td>
                  <td style={{ padding: 10 }}><PriorityPill priority={r.priority} /></td>
                  <td style={{ padding: 10 }}>{ST.categories[r.category]}</td>
                  <td style={{ padding: 10 }}>{ST.channels[r.channel]}</td>
                  <td style={{ padding: 10 }}>{r.assigned_name || "-"}</td>
                  <td style={{ padding: 10 }}><SlaChip ticket={r} now={now} /></td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{dateTime(r.last_message_at ?? r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d && (
        <div className="row">
          <button className="btn ghost sm" disabled={d.page <= 1} onClick={() => set({ page: d.page - 1 })}>{ST.prev}</button>
          <span className="hint">{ST.page(d.page, d.pages)}</span>
          <button className="btn ghost sm" disabled={d.page >= d.pages} onClick={() => set({ page: d.page + 1 })}>{ST.next}</button>
        </div>
      )}
    </div>
  );
}
