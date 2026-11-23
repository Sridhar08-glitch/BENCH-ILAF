"use client";

// The staff audit log: everything staff did, with category chips, filters and a CSV download (support and admin).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { sa } from "@/lib/staff-admin/api";
import { fmtWhen, humanAction } from "@/lib/staff-admin/format";
import { Await, NoRows, Page, Pager, Pill, RoleButton, Table, td, useDebounced, useFail } from "./ui";

export default function AuditLog() {
  const [category, setCategory] = useState("");
  const [role, setRole] = useState("");
  const [actor, setActor] = useState("");
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const toast = useToast();
  const fail = useFail();
  const dActor = useDebounced(actor);
  const dText = useDebounced(text);
  const filters = { category, role, actor: dActor, q: dText, from, to };
  const q = useQuery({ queryKey: ["staff-audit-log", filters, page], queryFn: () => sa.audit({ ...filters, page: String(page) }), placeholderData: (p) => p });
  const change = (fn: () => void) => { fn(); setPage(1); };
  return (
    <Page title="Audit log" sub="Every staff action, newest first. Entries cannot be changed or deleted."
      actions={<RoleButton perm="export" className="btn ghost sm" onClick={() => void sa.downloadAudit(filters).catch((e) => toast(fail(e)))}>Download CSV</RoleButton>}>
      <div className="row" role="group" aria-label="Category" style={{ gap: 6 }}>
        <button type="button" className={`btn sm ${category === "" ? "" : "ghost"}`} aria-pressed={category === ""} onClick={() => change(() => setCategory(""))}>All</button>
        {q.data?.categories.map((c) => (
          <button key={c.key} type="button" className={`btn sm ${category === c.key ? "" : "ghost"}`} aria-pressed={category === c.key} onClick={() => change(() => setCategory(c.key))}>{c.label}</button>
        ))}
      </div>
      <div className="row">
        <select value={role} onChange={(e) => change(() => setRole(e.target.value))} aria-label="Role"><option value="">Every role</option><option value="admin">Admin</option><option value="support">Support</option><option value="read_only">Read only</option></select>
        <input value={actor} onChange={(e) => change(() => setActor(e.target.value))} placeholder="Who (e-mail)" aria-label="Who" />
        <input value={text} onChange={(e) => change(() => setText(e.target.value))} placeholder="Search the target" aria-label="Search" />
        <label className="row">From <input type="date" value={from} onChange={(e) => change(() => setFrom(e.target.value))} /></label>
        <label className="row">To <input type="date" value={to} onChange={(e) => change(() => setTo(e.target.value))} /></label>
      </div>
      <Await q={q}>
        {(d) => (
          <>
            {d.results.length === 0 ? <NoRows>No entries match.</NoRows> : (
              <Table head={["When", "Who", "Category", "What", "Target", "From", "Details"]}>
                {d.results.map((e) => (
                  <tr key={e.id}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtWhen(e.created_at)}</td>
                    <td style={td}>{e.actor_name || "-"} <Pill>{e.actor_role || "system"}</Pill></td>
                    <td style={td}>{e.category_label ? <Pill>{e.category_label}</Pill> : ""}</td>
                    <td style={td}>{e.label || humanAction(e.action)}</td>
                    <td style={td}>{e.target_label}</td>
                    <td style={{ ...td, minWidth: 110 }}>{e.from}</td>
                    <td style={td}>{Object.keys(e.details ?? {}).length ? <span className="hint">{Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("; ").slice(0, 160)}</span> : ""}</td>
                  </tr>
                ))}
              </Table>
            )}
            <Pager page={d.page} pages={d.pages} count={d.count} onPage={setPage} />
          </>
        )}
      </Await>
    </Page>
  );
}
