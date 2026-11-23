"use client";

// System health: Health (speed and errors per hour, storage), E-mail (counts and failed sends with resend), Jobs, Errors.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { sa } from "@/lib/staff-admin/api";
import { fmtBytes, fmtMs, fmtNumber, fmtWhen } from "@/lib/staff-admin/format";
import { BarChart, LineChart } from "./charts";
import { Await, Kpi, NoRows, Page, Pager, Parked, Pill, RoleButton, Table, Tabs, td, toneOf, useFail } from "./ui";

const TABS = [{ key: "health", label: "Health" }, { key: "email", label: "E-mail" }, { key: "jobs", label: "Jobs" }, { key: "errors", label: "Errors" }] as const;
type Tab = (typeof TABS)[number]["key"];

function HealthTab() {
  const q = useQuery({ queryKey: ["staff-health"], queryFn: sa.systemHealth, refetchInterval: 60_000 });
  return (
    <Await q={q}>
      {(d) => {
        const hours = d.series.map((p) => String(new Date(p.hour).getUTCHours()).padStart(2, "0"));
        return (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <Kpi label="API" value={d.health.api_up ? "Up" : "Down"} />
              <Kpi label="Database" value={d.health.db_ok ? `${d.health.db_ms} ms` : "Down"} tone={d.health.db_ok ? undefined : "bad"} />
              <Kpi label="Speed (95 of 100 faster than)" value={fmtMs(d.health.p95_ms)} hint="last 10 minutes" />
              <Kpi label="Requests, last 10 min" value={fmtNumber(d.health.requests_10m)} />
              <Kpi label="Server errors, last hour" value={fmtNumber(d.health.errors_last_hour)} tone={d.health.errors_last_hour ? "bad" : undefined} />
            </div>
            <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}><h2 style={{ fontSize: 16 }}>Requests per hour, last 24 hours</h2>
              <BarChart label="Requests per hour" data={d.series.map((p, i) => ({ label: hours[i], value: p.requests }))} format={fmtNumber} /></section>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
              <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}><h2 style={{ fontSize: 16 }}>Speed per hour (95 of 100 faster than)</h2>
                <LineChart label="Speed per hour" labels={hours} series={[{ name: "Speed", values: d.series.map((p) => p.p95_ms), color: "#FF6B35" }]} format={(v) => fmtMs(Math.round(v))} /></section>
              <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}><h2 style={{ fontSize: 16 }}>Server errors per hour</h2>
                <BarChart label="Server errors per hour" color="#E11D48" data={d.series.map((p, i) => ({ label: hours[i], value: p.errors }))} /></section>
            </div>
            <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}><h2 style={{ fontSize: 16 }}>Storage</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                <Kpi label="Pictures (media folder)" value={fmtBytes(d.storage.media_bytes)} />
                <Kpi label="Private files and exports" value={fmtBytes(d.storage.private_bytes)} />
                <Kpi label="Database" value={fmtBytes(d.storage.database_bytes)} />
              </div></section>
          </>
        );
      }}
    </Await>
  );
}

function EmailTab() {
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const toast = useToast();
  const fail = useFail();
  const q = useQuery({ queryKey: ["staff-email", page], queryFn: () => sa.systemEmail({ page: String(page) }), placeholderData: (p) => p });
  return (
    <Await q={q}>
      {(d) => (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Kpi label="Sent, last 24 h" value={fmtNumber(d.last_24h.sent)} /><Kpi label="Failed, last 24 h" value={fmtNumber(d.last_24h.failed)} tone={d.last_24h.failed ? "bad" : undefined} />
          </div>
          <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}><h2 style={{ fontSize: 16 }}>Sent and failed per day</h2>
            <LineChart label="E-mails sent and failed per day" labels={d.days.map((x) => x.day.slice(5))} series={[{ name: "Sent", values: d.days.map((x) => x.sent), color: "#10B981" }, { name: "Failed", values: d.days.map((x) => x.failed), color: "#E11D48" }]} /></section>
          <h2 style={{ fontSize: 16 }}>Failed e-mails</h2>
          {d.results.length === 0 ? <NoRows>No failed e-mails.</NoRows> : (
            <Table head={["To", "Subject", "Why it failed", "When", ""]}>
              {d.results.map((e) => (
                <tr key={e.id}><td style={td}>{e.to}</td><td style={td}>{e.subject}</td><td style={td}>{e.error}</td><td style={td}>{fmtWhen(e.created_at)}</td>
                  <td style={td}><RoleButton perm="resend" className="btn sm" disabled={!e.can_resend} onClick={() => void sa.resendEmail(e.id).then(() => { toast("Sent again"); return qc.invalidateQueries({ queryKey: ["staff-email"] }); }).catch((x) => toast(fail(x)))}>Resend</RoleButton></td></tr>
              ))}
            </Table>
          )}
          <Pager page={d.page} pages={d.pages} count={d.count} onPage={setPage} />
          <p className="hint">The text of a failed e-mail is kept for 14 days so it can be sent again. Sent e-mails keep no text.</p>
        </>
      )}
    </Await>
  );
}

function JobsTab() {
  const q = useQuery({ queryKey: ["staff-jobs"], queryFn: sa.systemJobs, refetchInterval: 60_000 });
  return (
    <Await q={q}>
      {(d) => (
        <>
          {!d.state_dir_found && <Parked>This server keeps no job markers (it is not the production server), so the states are unknown.</Parked>}
          <Table head={["Job", "What it does", "Runs", "Last success", "Took", "State"]}>
            {d.jobs.map((j) => (
              <tr key={j.name}><td style={td}><b>{j.name}</b></td><td style={td}>{j.label}</td><td style={td}>{j.every}</td><td style={td}>{fmtWhen(j.last_ok_at)}</td><td style={td}>{j.duration_s == null ? "-" : `${j.duration_s} s`}</td>
                <td style={td}><Pill tone={toneOf(j.state)}>{j.state}</Pill>{j.note && <div className="hint">{j.note}</div>}</td></tr>
            ))}
          </Table>
        </>
      )}
    </Await>
  );
}

function ErrorsTab() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["staff-errors", page], queryFn: () => sa.systemErrors({ page: String(page) }), placeholderData: (p) => p });
  return (
    <Await q={q}>
      {(d) => (
        <>
          <p className="hint">The last 500 server errors, with personal details removed. The code identifies where it happened, so repeats group together.</p>
          {d.groups.length > 0 && (
            <section className="panel" style={{ padding: 14, display: "grid", gap: 6 }}><h2 style={{ fontSize: 16 }}>Most repeated</h2>
              {d.groups.map((g) => <div key={g.trace_hash} className="row" style={{ justifyContent: "space-between" }}><span>{g.message} <span className="hint">{g.path}</span></span><Pill tone="bad">{g.n}x</Pill></div>)}
            </section>
          )}
          {d.results.length === 0 ? <NoRows>No errors recorded.</NoRows> : (
            <Table head={["When", "Where", "Status", "Message", "Code"]}>
              {d.results.map((row) => <tr key={row.id}><td style={td}>{fmtWhen(row.at)}</td><td style={td}>{row.path || row.source}</td><td style={td}>{row.status || "-"}</td><td style={td}>{row.message}</td><td style={td}><code>{row.trace_hash}</code></td></tr>)}
            </Table>
          )}
          <Pager page={d.page} pages={d.pages} count={d.count} onPage={setPage} />
        </>
      )}
    </Await>
  );
}

export default function System() {
  const [tab, setTab] = useState<Tab>("health");
  return (
    <Page title="System health" sub="Is everything running, and what is failing.">
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "health" && <HealthTab />}
      {tab === "email" && <EmailTab />}
      {tab === "jobs" && <JobsTab />}
      {tab === "errors" && <ErrorsTab />}
    </Page>
  );
}
