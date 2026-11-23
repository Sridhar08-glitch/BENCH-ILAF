"use client";

// Applications and requests: companies that asked to talk to us, as a board by pipeline stage or as a table with a
// status and an assignee on every row, and a pointer to the design requests board.
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { Dialog } from "@/components/ops/shared";
import { countryName } from "@/lib/countries";
import { sa, type Application, type Assignee } from "@/lib/staff-admin/api";
import { fmtDay, fmtWhen } from "@/lib/staff-admin/format";
import { Await, NoRows, Page, Pill, RoleButton, Table, Tabs, td, toneOf, useCan, useFail } from "./ui";

const STAGES = ["new", "contacted", "qualified", "won", "lost"] as const;
type View = "table" | "board";

/** Saves a change of one request and refreshes the lists. */
function useUpdate() {
  const qc = useQueryClient();
  const toast = useToast();
  const fail = useFail();
  return async (id: string, body: { status?: string; assignee?: string | null; note?: string }): Promise<boolean> => {
    try {
      await sa.updateApplication(id, body);
      toast("Saved. Logged.");
      await qc.invalidateQueries({ queryKey: ["staff-applications"] });
      await qc.invalidateQueries({ queryKey: ["staff-overview"] });
      return true;
    } catch (e) {
      toast(fail(e));
      return false;
    }
  };
}

function AssigneeSelect({ a, people, onChange }: { a: Application; people: Assignee[]; onChange: (id: string | null) => void }) {
  const allowed = useCan("notes");
  return (
    <select value={a.assignee_id ?? ""} disabled={!allowed} title={allowed ? undefined : "Your role cannot assign requests"} aria-label={`Assigned to, ${a.company}`} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Unassigned</option>
      {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
    </select>
  );
}

function Drawer({ a, people, onClose }: { a: Application; people: Assignee[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fail = useFail();
  const update = useUpdate();
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const addNote = async () => {
    try { await sa.updateApplication(a.id, { note: note.trim() }); setErr(""); setNote(""); toast("Saved. Logged."); await qc.invalidateQueries({ queryKey: ["staff-applications"] }); }
    catch (e) { setErr(fail(e)); }
  };
  return (
    <Dialog title={a.company} onClose={onClose} wide>
      <div style={{ display: "grid", gap: 12 }}>
        <div><b>{a.name}</b> - <a href={`mailto:${a.email}`}>{a.email}</a><div className="hint">{a.size ? `${a.size} people, ` : ""}{a.country ? `${countryName(a.country, "en")}, ` : ""}via {a.source}, language {a.language || "unknown"}, asked {fmtWhen(a.created_at)}</div></div>
        {a.message && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>&ldquo;{a.message}&rdquo;</p>}
        <div className="row">{STAGES.map((s) => <RoleButton key={s} perm="notes" className={`btn sm ${a.status === s ? "" : "ghost"}`} disabled={a.status === s} onClick={() => void update(a.id, { status: s }).then((ok) => ok && onClose())}>{s}</RoleButton>)}</div>
        <label className="row">Assigned to <AssigneeSelect a={a} people={people} onChange={(id) => void update(a.id, { assignee: id })} /></label>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Add a note" aria-label="Note" style={{ flex: 1, minWidth: 220 }} />
          <RoleButton perm="notes" className="btn sm" disabled={!note.trim()} onClick={() => void addNote()}>Add note</RoleButton>
        </div>
        {err && <span className="err" role="alert">{err}</span>}
        <section><h4>Notes</h4>{a.notes.length === 0 && <span className="hint">None.</span>}{a.notes.map((n, i) => <div key={i}><b>{n.who}</b> {n.text} <span className="hint">{fmtWhen(n.t)}</span></div>)}</section>
      </div>
    </Dialog>
  );
}

function RequestsTable({ rows, people, onOpen }: { rows: Application[]; people: Assignee[]; onOpen: (id: string) => void }) {
  const update = useUpdate();
  const allowed = useCan("notes");
  if (rows.length === 0) return <NoRows>No requests in this stage.</NoRows>;
  return (
    <Table head={["Person and company", "Size", "Country", "Asked", "Status", "Assigned to"]}>
      {rows.map((a) => (
        <tr key={a.id}>
          <td style={td}>
            <button type="button" onClick={() => onOpen(a.id)} style={{ background: "none", border: 0, padding: 0, textAlign: "start", cursor: "pointer", display: "grid", gap: 2 }}>
              <b>{a.name}</b><span className="hint">{a.company} - {a.email}</span>
            </button>
          </td>
          <td style={{ ...td, whiteSpace: "nowrap" }}>{a.size || "-"}</td>
          <td style={td}>{a.country ? countryName(a.country, "en") : "-"}</td>
          <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDay(a.created_at)}</td>
          <td style={td}>
            <select value={a.status} disabled={!allowed} title={allowed ? undefined : "Your role cannot change requests"} aria-label={`Status, ${a.company}`} onChange={(e) => void update(a.id, { status: e.target.value })}>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </td>
          <td style={td}><AssigneeSelect a={a} people={people} onChange={(id) => void update(a.id, { assignee: id })} /></td>
        </tr>
      ))}
    </Table>
  );
}

export default function Applications() {
  const [tab, setTab] = useState<"signups" | "design">("signups");
  const [view, setView] = useState<View>("table");
  const [stage, setStage] = useState<string>("all");
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
            <>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="row" role="group" aria-label="Show as" style={{ gap: 6 }}>
                  <button type="button" className={`btn sm ${view === "table" ? "" : "ghost"}`} aria-pressed={view === "table"} onClick={() => setView("table")}>Table</button>
                  <button type="button" className={`btn sm ${view === "board" ? "" : "ghost"}`} aria-pressed={view === "board"} onClick={() => setView("board")}>Board</button>
                </div>
                <span className="hint">{d.count} requests</span>
              </div>
              {view === "table" ? (
                <>
                  <div className="row" role="group" aria-label="Status" style={{ gap: 6 }}>
                    {["all", ...STAGES].map((s) => (
                      <button key={s} type="button" className={`btn sm ${stage === s ? "" : "ghost"}`} aria-pressed={stage === s} onClick={() => setStage(s)} style={{ textTransform: "capitalize" }}>
                        {s}{s !== "all" && <span className="pill" style={{ marginInlineStart: 6 }}>{d.counts[s] ?? 0}</span>}
                      </button>
                    ))}
                  </div>
                  <RequestsTable rows={d.results.filter((a) => stage === "all" || a.status === stage)} people={d.assignees} onOpen={setOpenId} />
                </>
              ) : (
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
            </>
          )}
        </Await>
      )}
      {open && <Drawer a={open} people={q.data?.assignees ?? []} onClose={() => setOpenId(null)} />}
    </Page>
  );
}
