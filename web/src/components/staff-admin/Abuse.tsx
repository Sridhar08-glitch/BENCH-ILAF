"use client";

// Abuse and safety: the queue of card reports with answer-time timers, triage actions, bulk actions and a detail drawer.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { Dialog } from "@/components/ops/shared";
import { sa, type Report } from "@/lib/staff-admin/api";
import { cardStatusWord } from "@/lib/staff-admin/card-data";
import { fmtMinutes, fmtWhen } from "@/lib/staff-admin/format";
import { bulkSummary, reportNumber } from "@/lib/staff-admin/health";
import { StaffCardThumb } from "./StaffCardThumb";
import { Await, Chips, NoRows, OnlyFor, Page, Pager, Pill, ReasonDialog, RoleButton, Table, td, toneOf, useDebounced, useFail } from "./ui";

const STATUS_CHIPS = [{ key: "open", label: "Open" }, { key: "actioned", label: "Actioned" }, { key: "dismissed", label: "Dismissed" }, { key: "all", label: "All" }] as const;
type StatusKey = (typeof STATUS_CHIPS)[number]["key"];
const REASONS = [{ key: "", label: "Any reason" }, { key: "spam", label: "Spam" }, { key: "fake", label: "Fake person" }, { key: "offensive", label: "Offensive" }, { key: "impersonation", label: "Impersonation" }, { key: "other", label: "Other" }];

export function SlaPill({ r }: { r: Report }) {
  if (r.sla.state === "done") return <Pill tone={toneOf(r.status)}>{r.status}</Pill>;
  return <Pill tone={r.sla.state === "late" ? "bad" : r.sla.state === "soon" ? "warn" : "ok"}>{fmtMinutes(r.sla.minutes_left)}</Pill>;
}

function ReportDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fail = useFail();
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [dlg, setDlg] = useState<"suspend_card" | "suspend_company" | "warn" | "dismiss" | null>(null);
  const q = useQuery({ queryKey: ["staff-report", id], queryFn: () => sa.report(id) });
  const run = async (action: string, text?: string, confirmName?: string) => {
    await sa.reportAction(id, action, text, confirmName);
    toast("Done");
    await qc.invalidateQueries({ queryKey: ["staff-report", id] });
    await qc.invalidateQueries({ queryKey: ["staff-abuse"] });
    await qc.invalidateQueries({ queryKey: ["staff-overview"] });
  };
  return (
    <Dialog title="Card report" onClose={onClose} wide>
      <Await q={q}>
        {(r) => (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
              {r.card ? <StaffCardThumb card={r.card} width={180} /> : <Pill>Card deleted</Pill>}
              <div style={{ display: "grid", gap: 6, flex: 1, minWidth: 220 }}>
                <h3 style={{ fontSize: 18 }}>{r.reason_label} <span className="hint">{reportNumber(r)}</span></h3>
                <span className="row"><SlaPill r={r} /><Pill tone={toneOf(r.status)}>{r.status}</Pill>{r.outcome && <Pill>{r.outcome.replace("_", " ")}</Pill>}</span>
                {r.note && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>&ldquo;{r.note}&rdquo;</p>}
                <span className="hint">Reported {fmtWhen(r.created_at)}{r.reporter_email ? ` by ${r.reporter_email}` : " anonymously"}. Answer by {fmtWhen(r.due_at)}.</span>
                {r.card && <span>Card: <b>{r.card.name}</b> ({cardStatusWord(r.card)}) - <a href={r.card.public_url} target="_blank" rel="noopener noreferrer">public page</a></span>}
                {r.company_id && <span>Company: <Link href={`/staff/companies/${r.company_id}`}>{r.company_name}</Link></span>}
                <span className="hint">Assigned to {r.assignee ?? "nobody"}</span>
              </div>
            </div>
            {(r.status === "new" || r.status === "reviewing") && (
              <div className="row">
                <RoleButton perm="triage" className="btn sm ghost" onClick={() => void run("reviewing").catch((e) => setErr(fail(e)))}>{r.status === "new" ? "Start looking" : "Assign to me"}</RoleButton>
                <RoleButton perm="triage" className="btn sm ghost" onClick={() => setDlg("dismiss")}>Dismiss</RoleButton>
                <RoleButton perm="triage" className="btn sm" onClick={() => setDlg("warn")}>Warn the owner</RoleButton>
                <RoleButton perm="suspendCard" className="btn sm danger" onClick={() => setDlg("suspend_card")}>Suspend the card</RoleButton>
                <RoleButton perm="suspendCo" className="btn sm danger" onClick={() => setDlg("suspend_company")}>Suspend the company</RoleButton>
              </div>
            )}
            <div className="row" style={{ alignItems: "flex-start" }}>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Add a note" aria-label="Note" style={{ flex: 1, minWidth: 220 }} />
              <RoleButton perm="triage" className="btn sm" disabled={!note.trim()} onClick={() => void run("note", note.trim()).then(() => setNote("")).catch((e) => setErr(fail(e)))}>Add note</RoleButton>
            </div>
            {err && <span className="err" role="alert">{err}</span>}
            <section><h4>History of this report</h4>
              {r.history.length === 0 && <span className="hint">Nothing yet.</span>}
              {r.history.map((h, i) => <div key={i} className="row" style={{ justifyContent: "space-between" }}><span><b>{h.who}</b> {h.text}</span><span className="hint">{fmtWhen(h.t)}</span></div>)}
            </section>
            <section><h4>Other reports about this card or company</h4>
              {r.related.length === 0 && <span className="hint">None.</span>}
              {r.related.map((o) => <div key={o.id} className="row"><b>{o.reason_label}</b><Pill tone={toneOf(o.status)}>{o.status}</Pill><span className="hint">{o.card_name}, {fmtWhen(o.created_at)}</span></div>)}
            </section>
            {dlg === "dismiss" && <ReasonDialog title="Dismiss this report" text="No problem was found. The visitor is not told." confirm="Dismiss" minLength={0} onClose={() => setDlg(null)} onConfirm={(t) => run("dismiss", t)} />}
            {dlg === "warn" && <ReasonDialog title="Warn the owner" text="The owner gets an e-mail (in their language) that a visitor reported the card, and a request to fix it." confirm="Send warning" minLength={0} onClose={() => setDlg(null)} onConfirm={(t) => run("warn", t)} />}
            {dlg === "suspend_card" && <ReasonDialog title="Suspend the card" text="The public page shows that the card is no longer active. The company cannot restore it itself." confirm="Suspend card" danger onClose={() => setDlg(null)} onConfirm={(t) => run("suspend_card", t)} />}
            {dlg === "suspend_company" && <ReasonDialog title="Suspend the whole company" text="Every card of the company shows as unavailable and nobody can sign in to it. Only for serious abuse." confirm="Suspend company" danger typed={r.company_name} onClose={() => setDlg(null)} onConfirm={(t) => run("suspend_company", t, r.company_name)} />}
          </div>
        )}
      </Await>
    </Dialog>
  );
}

export default function Abuse() {
  const params = useSearchParams();
  const [status, setStatus] = useState<StatusKey>("open");
  const [reason, setReason] = useState("");
  const [late, setLate] = useState(false);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim(), 300);
  const [open, setOpen] = useState<string | null>(params.get("open"));
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["staff-abuse", status, reason, late, term, page], queryFn: () => sa.reports({ status, reason, late: late ? "1" : "", q: term, page: String(page) }), placeholderData: (p) => p, refetchInterval: 60_000 });
  const [dlg, setDlg] = useState<"dismiss" | "warn" | null>(null);
  const bulk = async (action: string, note?: string) => {
    const r = await sa.reportsBulk(picked, action, note);
    toast(bulkSummary(r.results, action === "warn" ? "warned" : "done"));
    setPicked([]);
    await qc.invalidateQueries({ queryKey: ["staff-abuse"] });
  };
  return (
    <Page title="Abuse and safety" sub="Reports from visitors about public cards. Answer within the time shown.">
      <div className="row"><Chips items={STATUS_CHIPS} value={status} onChange={(v) => { setStatus(v); setPage(1); setPicked([]); }} />
        <select value={reason} onChange={(e) => { setReason(e.target.value); setPage(1); }} aria-label="Reason">{REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
        <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search card, company or R-00042" aria-label="Search reports" style={{ minWidth: 200 }} />
        <label className="row"><input type="checkbox" checked={late} onChange={(e) => { setLate(e.target.checked); setPage(1); }} /> Late only</label>
      </div>
      {picked.length > 0 && (
        <OnlyFor perm="triage">
          <div className="notice"><div className="grow row"><b>{picked.length} selected</b>
            <button type="button" className="btn sm ghost" onClick={() => void bulk("assign")}>Assign to me</button>
            <button type="button" className="btn sm ghost" onClick={() => setDlg("dismiss")}>Dismiss</button>
            <button type="button" className="btn sm" onClick={() => setDlg("warn")}>Warn owners</button>
            <button type="button" className="btn sm ghost" onClick={() => setPicked([])}>Clear</button></div></div>
        </OnlyFor>
      )}
      <Await q={q}>
        {(d) => (
          <>
            <div className="row"><Pill tone={d.late ? "bad" : "ok"}>{d.late} late</Pill><span className="hint">{d.counts.new} new, {d.counts.reviewing} being looked at, {d.counts.actioned} actioned, {d.counts.dismissed} dismissed</span></div>
            {d.results.length === 0 ? <NoRows>No reports here.</NoRows> : (
              <Table head={["", "Report", "Card", "Company", "Reason", "Answer in", "Status", "Assigned", "Reported"]}>
                {d.results.map((r) => (
                  <tr key={r.id}>
                    <td style={td}><OnlyFor perm="triage"><input type="checkbox" checked={picked.includes(r.id)} onChange={() => setPicked((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]))} aria-label="Select report" /></OnlyFor></td>
                    <td style={td}><button type="button" className="btn ghost sm" onClick={() => setOpen(r.id)} aria-label={`Open report ${reportNumber(r)}`}>{reportNumber(r)}</button></td>
                    <td style={td}>{r.card_name || "(card)"}</td>
                    <td style={td}>{r.company_name || "-"}</td><td style={td}>{r.reason_label}</td><td style={td}><SlaPill r={r} /></td>
                    <td style={td}><Pill tone={toneOf(r.status)}>{r.status}</Pill></td><td style={td}>{r.assignee ?? "-"}</td><td style={td}>{fmtWhen(r.created_at)}</td>
                  </tr>
                ))}
              </Table>
            )}
            <Pager page={d.page} pages={d.pages} count={d.count} onPage={setPage} />
          </>
        )}
      </Await>
      {open && <ReportDrawer id={open} onClose={() => setOpen(null)} />}
      {dlg === "warn" && <ReasonDialog title={`Warn the owners of ${picked.length} report${picked.length === 1 ? "" : "s"}`} text="Each owner gets an e-mail (in their language) that a visitor reported their card, with the reason you write here. Each report is closed as warned and written to the audit log." confirm="Send warnings" onClose={() => setDlg(null)} onConfirm={(t) => bulk("warn", t)} />}
      {dlg === "dismiss" && <ReasonDialog title={`Dismiss ${picked.length} reports`} confirm="Dismiss" minLength={0} onClose={() => setDlg(null)} onConfirm={() => bulk("dismiss")} />}
    </Page>
  );
}
