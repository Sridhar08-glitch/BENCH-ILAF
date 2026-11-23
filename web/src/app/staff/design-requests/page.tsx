"use client";

// The design request board: one column per status, with filters, an assignee and a search.
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatusPill, STATUS_KEYS } from "@/components/designs/shared";
import { ErrorBox, SkeletonBlocks } from "@/components/app/ui";
import { staffApi, REQUEST_STATUSES } from "@/lib/designs/api";
import { useI18n } from "@/lib/i18n/client";

export default function BoardPage() {
  const { t, date } = useI18n();
  const [status, setStatus] = useState("");
  const [assignee, setAssignee] = useState("");
  const [q, setQ] = useState("");
  const board = useQuery({ queryKey: ["staff-board", status, assignee, q], queryFn: () => staffApi.board({ status, assignee, q }), placeholderData: (p) => p });
  if (board.isLoading) return <SkeletonBlocks rows={3} />;
  if (board.error || !board.data) return <ErrorBox error={board.error} onRetry={() => void board.refetch()} />;
  const b = board.data;
  const cols = REQUEST_STATUSES.filter((s) => !status || s === status);
  return (
    <div className="view">
      <h1>{t("staff.boardTitle")}</h1>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("staff.search")} aria-label={t("staff.search")} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("staff.filterStatus")}>
          <option value="">{t("staff.allStatuses")}</option>
          {REQUEST_STATUSES.map((s) => <option key={s} value={s}>{t(STATUS_KEYS[s])}</option>)}
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label={t("staff.filterAssignee")}>
          <option value="">{t("staff.everyone")}</option>
          <option value="me">{t("staff.mine")}</option>
          <option value="none">{t("staff.unassigned")}</option>
          {b.staff.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(240px, 1fr)", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
        {cols.map((s) => {
          const rows = b.results.filter((r) => r.status === s);
          return (
            <section key={s} aria-label={t(STATUS_KEYS[s])} className="panel" style={{ padding: 10, display: "grid", gap: 8, alignContent: "start", minHeight: 120 }}>
              <div className="row"><b>{t(STATUS_KEYS[s])}</b><span className="grow" /><span className="pill">{b.counts[s] ?? 0}</span></div>
              {rows.map((r) => (
                <Link key={r.id} href={`/staff/requests/${r.id}`} className="panel" style={{ padding: 10, textDecoration: "none", display: "grid", gap: 4, background: r.waiting_for_staff ? "var(--tint-orange)" : undefined }}>
                  <b>{r.company.name}</b>
                  <span className="hint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.goals}</span>
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    <StatusPill status={r.status} />
                    {r.waiting_for_staff && <span className="pill warn">{t("staff.waiting")}</span>}
                  </div>
                  <span className="hint">{r.assigned ? r.assigned.full_name || r.assigned.email : t("staff.unassigned")} · {date(r.updated_at)}</span>
                </Link>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
