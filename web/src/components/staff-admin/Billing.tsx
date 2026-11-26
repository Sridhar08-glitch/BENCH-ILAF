"use client";

// Billing: what the plans earn and what is about to happen to them. Summary tiles, then tables for renewals, failed payments,
// free weeks, payments (with a CSV) and the plans; plus the free plan periods granted by hand (admin only).
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { Dialog } from "@/components/ops/shared";
import { sa, type BillingPlan, type BillingSummary } from "@/lib/staff-admin/api";
import { cleanQuery, daysWord, qar, qarShort, renewalTone, renewalWord, stripeLink } from "@/lib/staff-admin/billing";
import { fmtDay, fmtNumber, fmtWhen } from "@/lib/staff-admin/format";
import { Await, Kpi, NoRows, Page, Pager, Pill, RoleButton, Table, Tabs, td, useCan, useDebounced, useFail } from "./ui";

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
  const needsSeats = plan === "enterprise";
  async function grant() {
    if (!company) return;
    setErr("");
    try {
      const r = await sa.grantPlan({ company_id: company.id, plan_code: plan || undefined, seats: seats ? Number(seats) : undefined, reason });
      toast(`${r.company}: ${r.plan}, ${r.seats} seats, until ${fmtDay(r.until)}`);
      await qc.invalidateQueries({ queryKey: ["staff-billing"] });
      onClose();
    } catch (e) { setErr(fail(e)); }
  }
  return (
    <Dialog title="Grant a free plan period" onClose={onClose} footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn" disabled={!company || reason.trim().length < 5 || (needsSeats && !seats)} onClick={() => void grant()}>Grant</button></>}>
      <div style={{ display: "grid", gap: 10 }}>
        <p className="hint" style={{ margin: 0 }}>This gives the company a new paid period without a payment. It is recorded as a manual grant, in the audit log and in the company&apos;s own activity.</p>
        {company ? <div className="row"><b>{company.name}</b><button type="button" className="btn ghost sm" onClick={() => setCompany(null)}>Change</button></div> : (
          <>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find the company" aria-label="Find a company" />
            {found.data?.results.slice(0, 6).map((c) => <button key={c.id} type="button" className="btn ghost sm" onClick={() => setCompany({ id: c.id, name: c.name })}>{c.name} <span className="hint">{c.owner_email}</span></button>)}
          </>
        )}
        <label style={{ display: "grid", gap: 4 }}>Plan<select value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">The standard company plan</option>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
        <label style={{ display: "grid", gap: 4 }}>{needsSeats ? "Seats (needed for Enterprise)" : "Seats (optional)"}<input type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} /></label>
        <label style={{ display: "grid", gap: 4 }}>Reason<textarea rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
        {err && <span className="err" role="alert">{err}</span>}
      </div>
    </Dialog>
  );
}

function Tiles({ s }: { s: BillingSummary }) {
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 } as const;
  const r = s.renewals;
  const f = s.free_weeks;
  const waiting = s.enterprise_requests.requested + s.enterprise_requests.quoted;
  return (
    <div style={{ display: "grid", gap: 10 }} aria-label="Billing summary">
      <div style={grid}>
        <Kpi label="Active paid subscriptions" value={fmtNumber(s.active_total)} hint={s.active_by_plan.map((p) => `${p.plan} ${p.subscriptions}`).join(", ") || "None yet"} />
        <Kpi label="Estimated yearly revenue" value={qarShort(s.arr_minor)} hint="An estimate: price x seats of the live paid plans. Enterprise uses its last payment." />
        <Kpi label="Failed payments now" value={fmtNumber(s.failed_payments)} tone={s.failed_payments ? "bad" : undefined} hint="Renewals Stripe could not charge" />
        <Link href="/staff/enterprise" style={{ textDecoration: "none", color: "inherit" }} aria-label="Enterprise requests waiting">
          <Kpi label="Enterprise requests waiting" value={fmtNumber(waiting)} hint={`${s.enterprise_requests.requested} to quote, ${s.enterprise_requests.quoted} quoted. Open the list.`} tone={s.enterprise_requests.requested ? "bad" : undefined} />
        </Link>
      </div>
      <div style={grid}>
        <Kpi label="Renewals due in 7 days" value={fmtNumber(r.in_7_days.auto + r.in_7_days.manual)} hint={`${r.in_7_days.auto} auto-renewing, ${r.in_7_days.manual} manual`} />
        <Kpi label="Renewals due in 30 days" value={fmtNumber(r.in_30_days.auto + r.in_30_days.manual)} hint={`${r.in_30_days.auto} auto-renewing, ${r.in_30_days.manual} manual`} />
        <Kpi label="In the grace days" value={fmtNumber(r.in_grace)} hint="Period ended, not paid yet" tone={r.in_grace ? "bad" : undefined} />
      </div>
      <div style={grid}>
        <Kpi label="Free weeks running" value={fmtNumber(f.running)} />
        <Kpi label="Free weeks ending within 2 days" value={fmtNumber(f.ending_soon)} />
        <Kpi label="Free weeks ended unpaid" value={fmtNumber(f.ended_unpaid)} />
        <Kpi label="Personal plans paid" value={fmtNumber(f.converted)} hint="Personal spaces now on a paid plan" />
      </div>
    </div>
  );
}

function WhoCell({ id, name, kind }: { id: string; name: string; kind: string }) {
  return kind === "company" ? <Link href={`/staff/companies/${id}`}><b>{name}</b></Link> : <span><b>{name}</b> <span className="hint">(personal)</span></span>;
}

function SortSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Sort by">{options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
}

function RenewalsTab() {
  const [windowDays, setWindow] = useState("30");
  const [renew, setRenew] = useState("");
  const [sort, setSort] = useState("soonest");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["staff-billing", "renewals", windowDays, renew, sort, page], queryFn: () => sa.billingRenewals({ ...cleanQuery({ window: windowDays, renew, sort }), page: String(page) }), placeholderData: (p) => p });
  return (
    <>
      <div className="row">
        <select value={windowDays} onChange={(e) => { setWindow(e.target.value); setPage(1); }} aria-label="Window"><option value="7">Next 7 days</option><option value="30">Next 30 days</option><option value="90">Next 90 days</option></select>
        <select value={renew} onChange={(e) => { setRenew(e.target.value); setPage(1); }} aria-label="Renewal"><option value="">Auto and manual</option><option value="auto">Auto-renewing</option><option value="manual">Manual or cancelling</option></select>
        <SortSelect value={sort} onChange={(v) => { setSort(v); setPage(1); }} options={[["soonest", "Soonest first"], ["company", "By company"], ["plan", "By plan"]]} />
      </div>
      <Await q={q}>
        {(d) => d.count === 0 ? <NoRows>No plan ends in this time.</NoRows> : (
          <>
            <Table head={["Company", "Owner", "Plan", "Seats", "Ends", "Renewal", "Payment"]}>
              {d.results.map((r) => (
                <tr key={r.workspace_id}>
                  <td style={td}><WhoCell id={r.workspace_id} name={r.company} kind={r.kind} /></td><td style={td}>{r.owner_email || "-"}</td><td style={td}>{r.plan}</td><td style={td}>{r.seats}</td>
                  <td style={td}>{fmtDay(r.ends_at)} <span className="hint">{daysWord(r.days_left)}</span></td>
                  <td style={td}><Pill tone={renewalTone(r.renewal)}>{renewalWord(r.renewal)}</Pill></td>
                  <td style={td}>{r.payment_failed ? <Pill tone="bad">Failed</Pill> : "-"}</td>
                </tr>
              ))}
            </Table>
            <Pager page={d.page} pages={d.pages} count={d.count} onPage={setPage} />
          </>
        )}
      </Await>
    </>
  );
}

function FailedTab() {
  const [sort, setSort] = useState("oldest");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["staff-billing", "failed", sort, page], queryFn: () => sa.billingFailed({ sort, page: String(page) }), placeholderData: (p) => p });
  return (
    <>
      <div className="row"><SortSelect value={sort} onChange={(v) => { setSort(v); setPage(1); }} options={[["oldest", "Failing longest first"], ["newest", "Newest first"], ["company", "By company"]]} /></div>
      <Await q={q}>
        {(d) => d.count === 0 ? <NoRows>No failed payments. All renewals are going through.</NoRows> : (
          <>
            <Table head={["Company", "Owner e-mail", "Plan", "Failed since", "Invoice", "Plan ends", "Grace days end"]}>
              {d.results.map((r) => {
                const link = stripeLink("invoice", r.invoice_id);
                return (
                  <tr key={r.workspace_id}>
                    <td style={td}><WhoCell id={r.workspace_id} name={r.company} kind={r.kind} /></td><td style={td}>{r.owner_email || "-"}</td><td style={td}>{r.plan}</td>
                    <td style={td}>{fmtWhen(r.failed_at)}</td>
                    <td style={td}>{r.invoice_id ? (link ? <a href={link} target="_blank" rel="noopener noreferrer">{r.invoice_id}</a> : r.invoice_id) : "-"}</td>
                    <td style={td}>{fmtDay(r.ends_at)}</td><td style={td}>{fmtDay(r.grace_ends_at)}{!r.live && <> <Pill tone="bad">Over</Pill></>}</td>
                  </tr>
                );
              })}
            </Table>
            <Pager page={d.page} pages={d.pages} count={d.count} onPage={setPage} />
          </>
        )}
      </Await>
    </>
  );
}

const FREE_STATE = { running: ["Running", "ok"], ending_soon: ["Ends within 2 days", "warn"], ended: ["Ended", "bad"] } as const;

function FreeWeeksTab() {
  const [state, setState] = useState("");
  const [sort, setSort] = useState("ends");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["staff-billing", "free", state, sort, page], queryFn: () => sa.billingFreeWeeks({ ...cleanQuery({ state, sort }), page: String(page) }), placeholderData: (p) => p });
  return (
    <>
      <div className="row">
        <select value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} aria-label="Stage"><option value="">Every free week</option><option value="running">Running</option><option value="ending_soon">Ending within 2 days</option><option value="ended">Ended unpaid</option></select>
        <SortSelect value={sort} onChange={(v) => { setSort(v); setPage(1); }} options={[["ends", "Ending soonest"], ["started", "Newest first"], ["owner", "By e-mail"]]} />
      </div>
      <Await q={q}>
        {(d) => d.count === 0 ? <NoRows>No free weeks match.</NoRows> : (
          <>
            <Table head={["Owner e-mail", "Started", "Ends", "Stage", "Card published"]}>
              {d.results.map((r) => (
                <tr key={r.workspace_id}>
                  <td style={td}>{r.owner_email || "-"}</td><td style={td}>{fmtWhen(r.started_at)}</td><td style={td}>{fmtWhen(r.ends_at)}</td>
                  <td style={td}><Pill tone={FREE_STATE[r.state][1]}>{FREE_STATE[r.state][0]}</Pill></td>
                  <td style={td}>{r.published ? "Yes" : "No"}</td>
                </tr>
              ))}
            </Table>
            <Pager page={d.page} pages={d.pages} count={d.count} onPage={setPage} />
          </>
        )}
      </Await>
    </>
  );
}

function PaymentsTab() {
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const toast = useToast();
  const fail = useFail();
  const term = useDebounced(q.trim());
  const query = cleanQuery({ q: term, source, sort });
  const list = useQuery({ queryKey: ["staff-billing", "payments", term, source, sort, page], queryFn: () => sa.billingPayments({ ...query, page: String(page) }), placeholderData: (p) => p });
  const canExport = useCan("export");
  return (
    <>
      <div className="row">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Invoice, company or Stripe invoice" aria-label="Search payments" style={{ minWidth: 260 }} />
        <select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} aria-label="Source"><option value="">Every source</option><option value="stripe">Stripe</option><option value="dev">Test payment</option><option value="manual">Granted by hand</option></select>
        <SortSelect value={sort} onChange={(v) => { setSort(v); setPage(1); }} options={[["newest", "Newest first"], ["oldest", "Oldest first"], ["amount", "Biggest first"], ["company", "By company"]]} />
        {canExport && <button type="button" className="btn ghost sm" onClick={() => void sa.downloadPayments(query).then(() => toast("Payments exported. Logged.")).catch((e) => toast(fail(e)))}>Export CSV</button>}
      </div>
      <Await q={list}>
        {(d) => d.count === 0 ? <NoRows>No payments match.</NoRows> : (
          <>
            <Table head={["Invoice", "Company", "Plan", "Seats", "Amount", "Source", "Paid", "Stripe invoice"]}>
              {d.results.map((p) => {
                const link = stripeLink("invoice", p.stripe_invoice_id);
                return (
                  <tr key={p.id}>
                    <td style={td}><b>{p.number}</b></td><td style={td}><WhoCell id={p.company_id} name={p.company} kind={p.kind} /></td><td style={td}>{p.plan}</td><td style={td}>{p.seats}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{qar(p.amount_minor)}</td><td style={td}>{p.source}</td><td style={td}>{fmtDay(p.paid_at)}</td>
                    <td style={td}>{p.stripe_invoice_id ? (link ? <a href={link} target="_blank" rel="noopener noreferrer">{p.stripe_invoice_id}</a> : p.stripe_invoice_id) : "-"}</td>
                  </tr>
                );
              })}
            </Table>
            <Pager page={d.page} pages={d.pages} count={d.count} onPage={setPage} />
          </>
        )}
      </Await>
    </>
  );
}

function PlansTab({ plans, summary }: { plans: BillingPlan[]; summary: BillingSummary }) {
  const arr = new Map(summary.active_by_plan.map((p) => [p.plan_code, p]));
  return (
    <Table head={["Code", "Plan", "Kind", "Price", "Per seat", "Min seats", "Cards", "For sale", "By quote", "Active", "Subscriptions", "Live paid"]}>
      {plans.map((p) => (
        <tr key={p.code}>
          <td style={td}><code>{p.code}</code></td><td style={td}><b>{p.name}</b></td><td style={td}>{p.kind}</td>
          <td style={td}>{p.by_quote ? "By quote (set per customer)" : p.price_minor === 0 ? "Free" : `${qar(p.price_minor)} per ${p.interval}`}</td>
          <td style={td}>{p.per_seat ? "Yes" : "No"}</td><td style={td}>{p.min_seats}</td><td style={td}>{p.max_cards}</td>
          <td style={td}>{p.purchasable ? <Pill tone="ok">Yes</Pill> : <Pill>No</Pill>}</td><td style={td}>{p.by_quote ? "Yes" : "No"}</td>
          <td style={td}>{p.active ? <Pill tone="ok">Yes</Pill> : <Pill>No</Pill>}</td><td style={td}>{p.companies}</td><td style={td}>{arr.get(p.code)?.subscriptions ?? 0}</td>
        </tr>
      ))}
    </Table>
  );
}

const TABS = [
  { key: "renewals", label: "Upcoming renewals" }, { key: "failed", label: "Failed payments" }, { key: "free", label: "Free weeks" },
  { key: "payments", label: "Payments" }, { key: "plans", label: "Plans" }, { key: "grants", label: "Granted by hand" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function Billing() {
  const [grant, setGrant] = useState(false);
  const [tab, setTab] = useState<Tab>("renewals");
  const q = useQuery({ queryKey: ["staff-billing"], queryFn: sa.billing });
  return (
    <Page title="Billing" sub="Plans, renewals and payments. Amounts are in QAR." actions={<RoleButton perm="plans" onClick={() => setGrant(true)}>Grant a plan period</RoleButton>}>
      <Await q={q}>
        {(d) => (
          <>
            <Tiles s={d.summary} />
            <Tabs tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: t.key === "failed" ? d.summary.failed_payments : undefined }))} value={tab} onChange={setTab} />
            {tab === "renewals" && <RenewalsTab />}
            {tab === "failed" && <FailedTab />}
            {tab === "free" && <FreeWeeksTab />}
            {tab === "payments" && <PaymentsTab />}
            {tab === "plans" && <PlansTab plans={d.plans} summary={d.summary} />}
            {tab === "grants" && (d.grants.length === 0 ? <NoRows>None yet.</NoRows> : (
              <Table head={["Company", "Plan", "Seats", "Until", "Granted"]}>
                {d.grants.map((g, i) => <tr key={i}><td style={td}><WhoCell id={g.company_id} name={g.company} kind={g.kind} /></td><td style={td}>{g.plan}</td><td style={td}>{g.seats}</td><td style={td}>{fmtDay(g.until)}</td><td style={td}>{fmtWhen(g.at)}</td></tr>)}
              </Table>
            ))}
            {grant && <GrantDialog plans={d.plans.filter((p) => p.kind === "company" && p.active)} onClose={() => setGrant(false)} />}
          </>
        )}
      </Await>
    </Page>
  );
}
