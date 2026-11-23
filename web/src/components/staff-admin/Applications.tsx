"use client";

// Applications and requests: companies that asked to talk to us (a board by pipeline stage), and a pointer to the
// design requests board.
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { Dialog } from "@/components/ops/shared";
import { sa, type Application } from "@/lib/staff-admin/api";
import { fmtWhen } from "@/lib/staff-admin/format";
import { Await, NoRows, Page, Pill, RoleButton, Tabs, toneOf, useFail } from "./ui";

const STAGES = ["new", "contacted", "qualified", "won", "lost"] as const;

function Drawer({ a, onClose }: { a: Application; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fail = useFail();
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const update = async (body: { status?: string; assignee?: string | null; note?: string }) => {
    try { await sa.updateApplication(a.id, body); setErr(""); setNote(""); toast("Saved"); await qc.invalidateQueries({ queryKey: ["staff-applications"] }); await qc.invalidateQueries({ queryKey: ["staff-overview"] }); if (body.status) onClose(); }
    catch (e) { setErr(fail(e)); }
  };
  return (
    <Dialog title={a.company} onClose={onClose} wide>
      <div style={{ display: "grid", gap: 12 }}>
        <div><b>{a.name}</b> - <a href={`mailto:${a.email}`}>{a.email}</a><div className="hint">{a.size ? `${a.size} people, ` : ""}via {a.source}, language {a.language || "unknown"}, asked {fmtWhen(a.created_at)}</div></div>
        {a.message && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>&ldquo;{a.message}&rdquo;</p>}
        <div className="row">{STAGES.map((s) => <RoleButton key={s} perm="notes" className={`btn sm ${a.status === s ? "" : "ghost"}`} disabled={a.status === s} onClick={() => void update({ status: s })}>{s}</RoleButton>)}</div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Add a note" aria-label="Note" style={{ flex: 1, minWidth: 220 }} />
          <RoleButton perm="notes" className="btn sm" disabled={!note.trim()} onClick={() => void update({ note: note.trim() })}>Add note</RoleButton>
        </div>
        {err && <span className="err" role="alert">{err}</span>}
        <section><h4>Notes</h4>{a.notes.length === 0 && <span className="hint">None.</span>}{a.notes.map((n, i) => <div key={i}><b>{n.who}</b> {n.text} <span className="hint">{fmtWhen(n.t)}</span></div>)}</section>
        <span className="hint">Assigned to {a.assignee ?? "nobody"}</span>
      </div>
    </Dialog>
  );
}

export default function Applications() {
  const [tab, setTab] = useState<"signups" | "design">("signups");
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["staff-applications"], queryFn: () => sa.applications({ page_size: "100" }), refetchInterval: 60_000 });
  const open = q.data?.results.find((a) => a.id === openId) ?? null;
  return (
    <Page title="Applications and requests" sub="Companies that asked to talk to us, and design requests.">
      <Tabs tabs={[{ key: "signups", label: "Sign-up and access requests" }, { key: "design", label: "Design requests", count: q.data?.design_requests_open }]} value={tab} onChange={setTab} />
      {tab === "design" ? (
        <div className="panel" style={{ padding: 16, display: "grid", gap: 8 }}>
          <p style={{ margin: 0 }}>Custom card design requests have their own board with messages, files and the face studio.</p>
          <div><Link href="/staff/design-requests" className="btn">Open the design requests board</Link></div>
        </div>
      ) : (
        <Await q={q}>
          {(d) => d.results.length === 0 ? <NoRows>No applications yet. Visitors can use the public form at /request-access.</NoRows> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, alignItems: "start" }}>
              {STAGES.map((s) => (
                <section key={s} className="panel" style={{ padding: 10, display: "grid", gap: 8, alignContent: "start", minHeight: 100 }} aria-label={s}>
                  <div className="row" style={{ justifyContent: "space-between" }}><b style={{ textTransform: "capitalize" }}>{s}</b><Pill tone={toneOf(s)}>{d.counts[s] ?? 0}</Pill></div>
                  {d.results.filter((a) => a.status === s).map((a) => (
                    <button key={a.id} type="button" className="panel" onClick={() => setOpenId(a.id)} style={{ padding: 8, textAlign: "start", cursor: "pointer", display: "grid", gap: 2 }}>
                      <b>{a.company}</b><span className="hint">{a.name}{a.size ? `, ${a.size}` : ""}</span><span className="hint">{fmtWhen(a.created_at)}</span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          )}
        </Await>
      )}
      {open && <Drawer a={open} onClose={() => setOpenId(null)} />}
    </Page>
  );
}
