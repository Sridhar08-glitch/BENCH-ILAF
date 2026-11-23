"use client";

// Overview: health strip, key numbers, 12 week growth, what needs attention, recent staff activity.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { sa, type Overview as OverviewData } from "@/lib/staff-admin/api";
import { fmtMs, fmtNumber, fmtWhen, humanAction } from "@/lib/staff-admin/format";
import { LineChart } from "./charts";
import { Await, Kpi, Page, Pill, toneOf } from "./ui";

function HealthStrip({ d }: { d: OverviewData }) {
  const h = d.health;
  const badJobs = d.jobs.filter((j) => j.state === "failed" || j.state === "late").length;
  const items: { label: string; value: string; tone: "ok" | "warn" | "bad" }[] = [
    { label: "API", value: h.api_up ? "Up" : "Down", tone: h.api_up ? "ok" : "bad" },
    { label: "Database", value: h.db_ok ? `OK (${h.db_ms} ms)` : "Not answering", tone: h.db_ok ? "ok" : "bad" },
    { label: "Speed (95 of 100 requests faster than)", value: fmtMs(h.p95_ms), tone: h.p95_ms != null && h.p95_ms > 1000 ? "warn" : "ok" },
    { label: "Server errors, last hour", value: String(h.errors_last_hour), tone: h.errors_last_hour > 10 ? "bad" : h.errors_last_hour > 0 ? "warn" : "ok" },
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
              <Kpi label="Companies" value={fmtNumber(d.numbers.companies)} />
              <Kpi label="Active cards" value={fmtNumber(d.numbers.active_cards)} />
              <Kpi label="Views today" value={fmtNumber(d.numbers.views_today)} />
              <Kpi label="New companies this week" value={fmtNumber(d.numbers.new_companies_week)} />
              <Kpi label="Open card reports" value={fmtNumber(d.numbers.open_reports)} tone={d.numbers.open_reports ? "bad" : undefined} />
              <Kpi label="Open data requests" value={fmtNumber(d.numbers.open_data_requests)} />
              {d.numbers.open_support_tickets != null && <Kpi label="Open support tickets" value={fmtNumber(d.numbers.open_support_tickets)} />}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
              <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }} aria-label="New companies per week">
                <h2 style={{ fontSize: 16 }}>New companies, last 12 weeks</h2>
                <LineChart label="New companies per week for 12 weeks" labels={d.growth.map((g) => g.week.slice(5))} series={[{ name: "New companies", values: d.growth.map((g) => g.n) }]} />
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
