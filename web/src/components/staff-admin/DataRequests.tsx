"use client";

// Data requests: exports and deletions with a due-date countdown. Support and admin start exports, confirm deletions
// (typed confirmation, extra tick for a company other people use) and mark requests done.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { sa, type DataRequest } from "@/lib/staff-admin/api";
import { fmtDays, fmtWhen } from "@/lib/staff-admin/format";
import { Await, Chips, NoRows, Page, Pager, Pill, ReasonDialog, RoleButton, Table, td, toneOf } from "./ui";

const FILTERS = [{ key: "open", label: "Open" }, { key: "completed", label: "Done" }, { key: "all", label: "All" }] as const;
type Filter = (typeof FILTERS)[number]["key"];
const OPEN = ["pending", "processing", "ready", "failed"];

export default function DataRequests() {
  const [status, setStatus] = useState<Filter>("open");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [dlg, setDlg] = useState<{ r: DataRequest; what: "delete" | "done" } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["staff-data-requests", status, kind, page], queryFn: () => sa.dataRequests({ status, kind, page: String(page) }), placeholderData: (p) => p, refetchInterval: 60_000 });
  const refresh = async (msg: string) => { toast(msg); await qc.invalidateQueries({ queryKey: ["staff-data-requests"] }); await qc.invalidateQueries({ queryKey: ["staff-overview"] }); };
  return (
    <Page title="Data requests" sub="People asking for their data or for it to be erased. The law sets the due date.">
      <div className="row"><Chips items={FILTERS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
        <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} aria-label="Kind"><option value="">Exports and deletions</option><option value="export">Exports</option><option value="delete">Deletions</option></select></div>
      <Await q={q}>
        {(d) => (
          <>
            {d.overdue > 0 && <div className="notice bad" role="alert"><div className="grow"><b>{d.overdue} past the legal due date</b>Deal with these first.</div></div>}
            {d.results.length === 0 ? <NoRows>No requests here.</NoRows> : (
              <Table head={["Who", "Request", "Due", "Status", "Handled by", "Actions"]}>
                {d.results.map((r) => (
                  <tr key={r.id}>
                    <td style={td}><b>{r.user_email || "(deleted person)"}</b>{r.company_name && <div className="hint">Company: {r.company_name}</div>}{r.owns_company_with_people && <div><Pill tone="warn">Owns a company with people</Pill></div>}</td>
                    <td style={td}>{r.kind === "export" ? "Export" : "Delete"} {r.scope === "workspace" ? "company data" : "account"}<div className="hint">Asked {fmtWhen(r.requested_at)}</div></td>
                    <td style={td}>{OPEN.includes(r.status) ? <Pill tone={r.overdue ? "bad" : r.days_left <= 5 ? "warn" : "ok"}>{fmtDays(r.days_left)}</Pill> : fmtWhen(r.completed_at)}<div className="hint">{fmtWhen(r.due_at)}</div></td>
                    <td style={td}><Pill tone={toneOf(r.status)}>{r.status}</Pill>{r.error && <div className="err">{r.error}</div>}{r.scheduled_for && r.status === "pending" && <div className="hint">Erased {fmtWhen(r.scheduled_for)}</div>}</td>
                    <td style={td}>{r.handled_by ?? "-"}</td>
                    <td style={td}>
                      <div className="row">
                        {r.kind === "export" && (r.status === "pending" || r.status === "failed") && <RoleButton perm="data" className="btn sm" onClick={() => void sa.dataAction(r.id, { action: "start_export" }).then(() => refresh("Export started"))}>Start export</RoleButton>}
                        {r.kind === "delete" && r.status === "pending" && <RoleButton perm="data" className="btn sm danger" onClick={() => setDlg({ r, what: "delete" })}>Confirm delete</RoleButton>}
                        {OPEN.includes(r.status) && <RoleButton perm="data" className="btn sm ghost" onClick={() => setDlg({ r, what: "done" })}>Mark done</RoleButton>}
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            <Pager page={d.page} pages={d.pages} count={d.count} onPage={setPage} />
          </>
        )}
      </Await>
      {dlg?.what === "delete" && (
        <ReasonDialog
          title="Erase this data now" danger confirm="Erase now" minLength={5}
          text={<>This erases {dlg.r.scope === "workspace" ? "the whole company" : "the account"} before the grace period ends. It cannot be undone.</>}
          typed={dlg.r.scope === "workspace" ? dlg.r.company_name : dlg.r.user_email}
          extraCheck={dlg.r.scope === "workspace" || dlg.r.owns_company_with_people ? "I know this erases a company that other people use." : undefined}
          onClose={() => setDlg(null)}
          onConfirm={async (reason, extra) => { await sa.dataAction(dlg.r.id, { action: "confirm_delete", typed: dlg.r.scope === "workspace" ? dlg.r.company_name : dlg.r.user_email, ack_company: extra || undefined, reason: reason || undefined }); await refresh("Erased and logged"); }}
        />
      )}
      {dlg?.what === "done" && (
        <ReasonDialog title="Mark this request as done" text="Use this when you dealt with it by hand." confirm="Mark done" minLength={0} onClose={() => setDlg(null)}
          onConfirm={async (note) => { await sa.dataAction(dlg.r.id, { action: "mark_done", note }); await refresh("Marked as done"); }} />
      )}
    </Page>
  );
}
