"use client";

// The money part of the overview and the analytics: how many people become paying customers (7 or 30 days), revenue per month in QAR,
// the renewals that are due and the payments that failed.
import Link from "next/link";
import { useState } from "react";
import type { MoneyBlock } from "@/lib/staff-admin/api";
import { funnelRows, qar, qarShort, revenuePoints } from "@/lib/staff-admin/billing";
import { fmtNumber } from "@/lib/staff-admin/format";
import { BarChart, HBars } from "./charts";
import { Chips, Kpi } from "./ui";

const WINDOWS = [{ key: "7", label: "7 days" }, { key: "30", label: "30 days" }] as const;

export function MoneyKpis({ m }: { m: MoneyBlock }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }} aria-label="Renewals and failed payments">
      <Link href="/staff/billing" style={{ textDecoration: "none", color: "inherit" }}><Kpi label="Renewals due in 7 days" value={fmtNumber(m.renewals_due_7)} hint={`${fmtNumber(m.renewals_due_30)} in 30 days`} /></Link>
      <Link href="/staff/billing" style={{ textDecoration: "none", color: "inherit" }}><Kpi label="Failed payments" value={fmtNumber(m.failed_payments)} tone={m.failed_payments ? "bad" : undefined} hint="Renewals that could not be charged" /></Link>
      <Link href="/staff/enterprise" style={{ textDecoration: "none", color: "inherit" }}><Kpi label="Enterprise requests waiting" value={fmtNumber(m.enterprise_requests_waiting)} tone={m.enterprise_requests_waiting ? "bad" : undefined} /></Link>
    </div>
  );
}

export function Funnel({ m }: { m: MoneyBlock }) {
  const [days, setDays] = useState<"7" | "30">("30");
  const rows = funnelRows(m.funnel[days]);
  return (
    <section className="panel" style={{ padding: 14, display: "grid", gap: 8, alignContent: "start" }} aria-label="Conversion funnel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 16 }}>From sign-up to paying</h2>
        <Chips items={WINDOWS} value={days} onChange={setDays} />
      </div>
      <HBars color="#10B981" rows={rows.map((r) => ({ label: r.label, value: r.value }))} format={(v) => fmtNumber(v)} />
      <ul className="hint" style={{ margin: 0, paddingInlineStart: 18 }}>
        {rows.slice(1).map((r) => <li key={r.key}>{r.label}: {r.percent}% of the people who signed up</li>)}
      </ul>
      <p className="hint" style={{ margin: 0 }}>People who signed up in the last {days} days. Publishing starts the free week. A person who bought straight away counts as converted.</p>
    </section>
  );
}

export function Revenue({ m }: { m: MoneyBlock }) {
  const total = m.revenue_monthly.reduce((n, r) => n + r.amount_minor, 0);
  return (
    <section className="panel" style={{ padding: 14, display: "grid", gap: 8, alignContent: "start" }} aria-label="Revenue per month">
      <h2 style={{ fontSize: 16 }}>Revenue per month (QAR)</h2>
      <BarChart label="Revenue per month in QAR, last 12 months" color="#8B5CF6" data={revenuePoints(m.revenue_monthly)} format={(v) => v.toLocaleString("en-US")} />
      <p className="hint" style={{ margin: 0 }}>{qarShort(total)} in the last 12 months ({qar(total)}). Payments granted by hand are free and not counted.</p>
    </section>
  );
}
