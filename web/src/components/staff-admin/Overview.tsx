"use client";

// Overview: health strip, key numbers, 12 week growth, what needs attention, recent staff activity.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { sa, type Overview as OverviewData } from "@/lib/staff-admin/api";
import { fmtMs, fmtNumber, fmtWhen, humanAction } from "@/lib/staff-admin/format";
import { changeText, errorRateTone, fmtPercent, versusText } from "@/lib/staff-admin/health";
import { BarChart, LineChart } from "./charts";
import { Funnel, MoneyKpis, Revenue } from "./MoneyPanels";
import { Await, Kpi, Page, Pill, toneOf } from "./ui";

const EVENT_LABEL = { signup: "Sign-up", card: "New card", upgrade: "Upgrade", support: "Support" } as const;

function HealthStrip({ d }: { d: OverviewData }) {
  const h = d.health;
  const badJobs = d.jobs.filter((j) => j.state === "failed" || j.state === "late").length;
  const items: { label: string; value: string; tone: "ok" | "warn" | "bad" }[] = [
    { label: "API", value: h.api_up ? "Up" : "Down", tone: h.api_up ? "ok" : "bad" },
    { label: "Database", value: h.db_ok ? `OK (${h.db_ms} ms)` : "Not answering", tone: h.db_ok ? "ok" : "bad" },
    { label: "Speed (95 of 100 requests faster than)", value: fmtMs(h.p95_ms), tone: h.p95_ms != null && h.p95_ms > 1000 ? "warn" : "ok" },
    { label: "Server errors, last hour", value: h.error_rate_1h == null ? String(h.errors_last_hour) : `${h.errors_last_hour} (${fmtPercent(h.error_rate_1h)})`, tone: h.errors_last_hour > 10 ? "bad" : errorRateTone(h.error_rate_1h) },
    { label: "Requests answered without an error, 7 days", value: fmtPercent(h.success_rate_7d), tone: h.success_rate_7d != null && h.success_rate_7d < 99 ? "warn" : "ok" },
    { label: "Scheduled jobs", value: badJobs ? `${badJobs} need a look` : "All on time", tone: badJobs ? "bad" : "ok" },
    { label: "E-mail, last 24 h", value: `${d.email.sent} sent, ${d.email.failed} failed`, tone: d.email.failed ? "warn" : "ok" },
  ];
  return (
    <Link href="/staff/system" className="panel" style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, textDecoration: "none" }} aria-label="System health">
      {items.map((i) => (
        <span key={i.label} style={{ display: "grid", gap: 2 }}>
          <span className="hint">{i.label}</span>
          <span><Pill tone={i.tone}>{i.value}</Pill></span>
        </span>
      ))}
    </Link>
  );
}

export default function Overview() {
  const q = useQuery({ queryKey: ["staff-overview"], queryFn: sa.overview, refetchInterval: 60_000 });
  return (
    <Page title="Overview" sub="How the product is doing right now.">
      <Await q={q}>
        {(d) => (
          <>
            <HealthStrip d={d} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <Kpi label="Companies" value={fmtNumber(d.numbers.companies)} hint={changeText(d.numbers.deltas.companies_4w, "in 4 weeks")} />
              <Kpi label="Active cards" value={fmtNumber(d.numbers.active_cards)} hint={changeText(d.numbers.deltas.active_cards_4w, "in 4 weeks")} />
              <Kpi label="Views today" value={fmtNumber(d.numbers.views_today)} hint={versusText(d.numbers.views_today, d.numbers.deltas.views_yesterday, "yesterday")} />
              <Kpi label="New companies this week" value={fmtNumber(d.numbers.new_companies_week)} hint={versusText(d.numbers.new_companies_week, d.numbers.deltas.new_companies_prev_week, "last week")} />
              <Kpi label="Open card reports" value={fmtNumber(d.numbers.open_reports)} tone={d.numbers.open_reports ? "bad" : undefined} hint={`${d.numbers.deltas.reports_late} past the answer time`} />
              <Kpi label="Open data requests" value={fmtNumber(d.numbers.open_data_requests)} hint={`${d.numbers.deltas.data_due_soon} due within 5 days`} />
              {d.numbers.open_support_tickets != null && <Kpi label="Open support tickets" value={fmtNumber(d.numbers.open_support_tickets)} />}
            </div>
            <MoneyKpis m={d.money} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
              <Funnel m={d.money} />
              <Revenue m={d.money} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
              <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }} aria-label="New companies per week">
                <h2 style={{ fontSize: 16 }}>New companies, last 12 weeks</h2>
                <BarChart label="New companies per week for 12 weeks" data={d.growth.map((g) => ({ label: g.week.slice(5), value: g.n }))} />
              </section>
              <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }} aria-label="Total companies">
                <h2 style={{ fontSize: 16 }}>Total companies, last 12 weeks</h2>
                <LineChart label="Total companies at the end of each week" labels={d.growth_total.map((g) => g.week.slice(5))} series={[{ name: "Total companies", values: d.growth_total.map((g) => g.n), color: "#10B981" }]} />
              </section>
              <section className="panel" style={{ padding: 14, display: "grid", gap: 8, alignContent: "start" }} aria-label="Needs attention">
                <h2 style={{ fontSize: 16 }}>Needs attention</h2>
                {d.attention.length === 0 && <p className="sub">Nothing is waiting. All clear.</p>}
                {d.attention.map((a) => (
                  <Link key={a.kind} href={a.path} className="row" style={{ textDecoration: "none", justifyContent: "space-between", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 10 }}>
                    <span>{a.text}</span><Pill tone={a.level === "bad" ? "bad" : a.level === "warn" ? "warn" : ""}>{a.level === "bad" ? "Act now" : a.level === "warn" ? "Soon" : "Info"}</Pill>
                  </Link>
                ))}
              </section>
            </div>
            <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }} aria-label="Customer activity">
              <h2 style={{ fontSize: 16 }}>What customers did lately</h2>
              {d.customer_events.length === 0 && <p className="sub">Nothing in the last 30 days.</p>}
              {d.customer_events.map((e, i) => (
                <Link key={`${e.kind}${e.at}${i}`} href={e.path} className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 6, textDecoration: "none" }}>
                  <span><Pill tone={e.kind === "upgrade" ? "ok" : e.kind === "support" ? "warn" : ""}>{EVENT_LABEL[e.kind]}</Pill> {e.text}</span>
                  <span className="hint">{fmtWhen(e.at)}</span>
                </Link>
              ))}
            </section>
            <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }} aria-label="Recent staff activity">
              <div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ fontSize: 16 }}>Recent staff activity</h2><Link href="/staff/audit" className="btn ghost sm">Open the audit log</Link></div>
              {d.recent_activity.length === 0 && <p className="sub">No staff activity yet.</p>}
              {d.recent_activity.map((e) => (
                <div key={e.id} className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                  <span><b>{e.actor_email || "-"}</b> <Pill tone={toneOf("")}>{e.actor_role || "system"}</Pill> {e.label || humanAction(e.action)}{e.target_label ? `: ${e.target_label}` : ""}</span>
                  <span className="hint">{fmtWhen(e.created_at)}</span>
                </div>
              ))}
            </section>
          </>
        )}
      </Await>
    </Page>
  );
}
