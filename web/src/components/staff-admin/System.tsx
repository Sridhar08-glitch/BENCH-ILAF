"use client";

// System health: Health (speed and errors per hour, storage), E-mail (counts and failed sends with resend), Jobs, Errors.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { sa } from "@/lib/staff-admin/api";
import { fmtBytes, fmtMs, fmtNumber, fmtWhen } from "@/lib/staff-admin/format";
import { errorRateTone, fmtPercent, storageShares } from "@/lib/staff-admin/health";
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
              <Kpi label="Typical speed (median)" value={fmtMs(d.health.p50_ms)} hint="last hour" />
              <Kpi label="Requests, last 10 min" value={fmtNumber(d.health.requests_10m)} />
              <Kpi label="Server errors, last hour" value={fmtNumber(d.health.errors_last_hour)} tone={d.health.errors_last_hour ? "bad" : undefined} />
              <Kpi label="Error rate, last hour" value={fmtPercent(d.health.error_rate_1h)} tone={errorRateTone(d.health.error_rate_1h) === "bad" ? "bad" : undefined} hint={d.health.requests_1h ? `of ${fmtNumber(d.health.requests_1h)} requests` : "no requests yet"} />
              <Kpi label="Answered without an error" value={fmtPercent(d.health.success_rate_7d)} hint={d.health.requests_7d ? `last 7 days, ${fmtNumber(d.health.requests_7d)} requests` : "last 7 days, no requests yet"} />
            </div>
            <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }} aria-label="Queues"><h2 style={{ fontSize: 16 }}>Work waiting in queues</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                {d.queues.map((qu) => (
                  <div key={qu.key} style={{ display: "grid", gap: 2, padding: 10, border: "1px solid var(--line)", borderRadius: 10 }}>
                    <span className="hint">{qu.label}</span>
                    <b style={{ fontSize: 24, color: qu.state === "bad" ? "var(--danger)" : undefined }}>{fmtNumber(qu.waiting)}</b>
                    {qu.failing > 0 ? <Pill tone="warn">{qu.failing} failed</Pill> : <Pill tone={qu.state}>{qu.state === "bad" ? "Too many waiting" : "On time"}</Pill>}
                  </div>
                ))}
              </div>
              <p className="hint" style={{ margin: 0 }}>A queue turns red above 50 waiting items.</p>
            </section>
            <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}><h2 style={{ fontSize: 16 }}>Requests per hour, last 24 hours</h2>
              <BarChart label="Requests per hour" data={d.series.map((p, i) => ({ label: hours[i], value: p.requests }))} format={fmtNumber} /></section>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
              <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}><h2 style={{ fontSize: 16 }}>Speed per hour (95 of 100 faster than)</h2>
                <LineChart label="Speed per hour" labels={hours} series={[{ name: "95 of 100 faster than", values: d.series.map((p) => p.p95_ms), color: "#FF6B35" }, { name: "Median", values: d.series.map((p) => p.p50_ms), color: "#3B82F6" }]} format={(v) => fmtMs(Math.round(v))} /></section>
              <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}><h2 style={{ fontSize: 16 }}>Server error rate per hour</h2>
                <LineChart label="Server error rate per hour" labels={hours} series={[{ name: "Error rate", values: d.series.map((p) => p.error_rate), color: "#E11D48" }]} format={(v) => `${Number(v.toFixed(2))}%`} /></section>
            </div>
            <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}><h2 style={{ fontSize: 16 }}>Storage</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                <Kpi label="Pictures (media folder)" value={fmtBytes(d.storage.media_bytes)} />
                <Kpi label="Private files and exports" value={fmtBytes(d.storage.private_bytes)} />
                <Kpi label="Database" value={fmtBytes(d.storage.database_bytes)} />
              </div>
              <h3 style={{ fontSize: 14 }}>By kind of file</h3>
              <div style={{ display: "grid", gap: 8 }}>
                {storageShares(d.storage.categories).map((c) => (
                  <div key={c.key} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 190px) 1fr auto", gap: 8, alignItems: "center" }}>
                    <span>{c.label}</span>
                    <span style={{ background: "var(--surface-2)", borderRadius: 999, height: 10, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${c.share}%`, background: "var(--accent, #FF6B35)", borderRadius: 999 }} /></span>
                    <b>{fmtBytes(c.bytes)}</b>
                  </div>
                ))}
              </div>
              <p className="hint" style={{ margin: 0 }}>Sizes are counted from the folders and refreshed every five minutes. Backups are kept outside the application and are not counted here.</p>
            </section>
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
            {d.bounce.connected
              ? <><Kpi label="Bounced, last 24 h" value={fmtNumber(d.bounce.bounced)} /><Kpi label="Bounce rate" value={fmtPercent(d.bounce.rate)} /></>
              : <Kpi label="Bounced e-mails" value="Not connected" hint="The mail provider does not report bounces back yet, so no number is shown." />}
          </div>
          <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}><h2 style={{ fontSize: 16 }}>Sent and failed per day</h2>
            <LineChart label="E-mails sent and failed per day" labels={d.days.map((x) => x.day.slice(5))} series={[{ name: "Sent", values: d.days.map((x) => x.sent), color: "#10B981" }, { name: "Failed", values: d.days.map((x) => x.failed), color: "#E11D48" }]} /></section>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ fontSize: 16 }}>Failed e-mails</h2>
            <RoleButton perm="resend" className="btn sm" disabled={d.resendable === 0}
              onClick={() => void sa.resendAllEmails().then((r) => { toast(`${r.sent} of ${r.tried} sent again`); return qc.invalidateQueries({ queryKey: ["staff-email"] }); }).catch((x) => toast(fail(x)))}>Resend all ({d.resendable})</RoleButton>
          </div>
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
