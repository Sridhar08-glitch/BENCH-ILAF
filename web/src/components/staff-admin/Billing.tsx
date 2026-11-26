"use client";

// Billing (placeholder): the plan list, free periods granted by hand (admin only) and an invoices placeholder. Payments are parked.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { Dialog } from "@/components/ops/shared";
import { sa } from "@/lib/staff-admin/api";
import { fmtDay, fmtWhen } from "@/lib/staff-admin/format";
import { Await, NoRows, Page, Parked, Pill, RoleButton, Table, td, useDebounced, useFail } from "./ui";

function GrantDialog({ plans, onClose }: { plans: { code: string; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fail = useFail();
  const [q, setQ] = useState("");
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [plan, setPlan] = useState("");
  const [seats, setSeats] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const term = useDebounced(q.trim());
  const found = useQuery({ queryKey: ["staff-companies", term, "", "", "name", 1, "grant"], queryFn: () => sa.companies({ q: term }), enabled: term.length >= 2 && !company });
  async function grant() {
    if (!company) return;
    setErr("");
    try {
      const r = await sa.grantPlan({ company_id: company.id, plan_code: plan || undefined, seats: seats ? Number(seats) : undefined, reason });
      toast(`${r.company}: ${r.plan} until ${fmtDay(r.until)}`);
      await qc.invalidateQueries({ queryKey: ["staff-billing"] });
      onClose();
    } catch (e) { setErr(fail(e)); }
  }
  return (
    <Dialog title="Grant a free plan period" onClose={onClose} footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn" disabled={!company || reason.trim().length < 5} onClick={() => void grant()}>Grant</button></>}>
      <div style={{ display: "grid", gap: 10 }}>
        <p className="hint" style={{ margin: 0 }}>This gives the company a new paid period without a payment. It is recorded as a manual grant and in the audit log.</p>
        {company ? <div className="row"><b>{company.name}</b><button type="button" className="btn ghost sm" onClick={() => setCompany(null)}>Change</button></div> : (
          <>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find the company" aria-label="Find a company" />
            {found.data?.results.slice(0, 6).map((c) => <button key={c.id} type="button" className="btn ghost sm" onClick={() => setCompany({ id: c.id, name: c.name })}>{c.name} <span className="hint">{c.owner_email}</span></button>)}
          </>
        )}
        <label style={{ display: "grid", gap: 4 }}>Plan<select value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">The standard company plan</option>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
        <label style={{ display: "grid", gap: 4 }}>Seats (optional)<input type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} /></label>
        <label style={{ display: "grid", gap: 4 }}>Reason<textarea rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
        {err && <span className="err" role="alert">{err}</span>}
      </div>
    </Dialog>
  );
}

export default function Billing() {
  const [grant, setGrant] = useState(false);
  const q = useQuery({ queryKey: ["staff-billing"], queryFn: sa.billing });
  return (
    <Page title="Billing" sub="Plans and free periods." actions={<RoleButton perm="plans" onClick={() => setGrant(true)}>Grant a plan period</RoleButton>}>
      <Parked><b>Payments are parked.</b> Nothing on this screen charges anyone. Companies get a plan through a free period granted here until online payments are switched on.</Parked>
      <Await q={q}>
        {(d) => (
          <>
            <h2 style={{ fontSize: 16 }}>Plans</h2>
            <Table head={["Plan", "Kind", "Price", "Per seat", "Cards", "Companies", "Active"]}>
              {d.plans.map((p) => (
                <tr key={p.code}><td style={td}><b>{p.name}</b><div className="hint">{p.code}</div></td><td style={td}>{p.kind}</td><td style={td}>{p.code === "enterprise" ? "By quote (set per customer)" : `${(p.price_minor / 100).toFixed(2)} ${p.currency} per ${p.interval}`}</td><td style={td}>{p.per_seat ? `Yes (min ${p.min_seats})` : "No"}</td><td style={td}>{p.max_cards}</td><td style={td}>{p.companies}</td><td style={td}>{p.active ? <Pill tone="ok">Yes</Pill> : <Pill>No</Pill>}</td></tr>
              ))}
            </Table>
            <h2 style={{ fontSize: 16 }}>Free periods granted by hand</h2>
            {d.grants.length === 0 ? <NoRows>None yet.</NoRows> : (
              <Table head={["Company", "Plan", "Seats", "Until", "Granted"]}>
                {d.grants.map((g, i) => <tr key={i}><td style={td}>{g.company}</td><td style={td}>{g.plan}</td><td style={td}>{g.seats}</td><td style={td}>{fmtDay(g.until)}</td><td style={td}>{fmtWhen(g.at)}</td></tr>)}
              </Table>
            )}
            <h2 style={{ fontSize: 16 }}>Invoices</h2>
            <NoRows>Invoices will appear here when payments are switched on.</NoRows>
            {grant && <GrantDialog plans={d.plans.filter((p) => p.kind === "company" && p.active)} onClose={() => setGrant(false)} />}
          </>
        )}
      </Await>
    </Page>
  );
}
