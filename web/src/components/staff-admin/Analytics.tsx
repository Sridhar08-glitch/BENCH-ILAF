"use client";

// Business analytics: key numbers, then tabs for growth, usage, where customers are, top companies and retention. CSV for support and admin.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { sa } from "@/lib/staff-admin/api";
import { countryName } from "@/lib/countries";
import { fmtNumber } from "@/lib/staff-admin/format";
import { monthLabel } from "@/lib/staff-admin/health";
import { BarChart, HBars, LineChart } from "./charts";
import { Funnel, MoneyKpis, Revenue } from "./MoneyPanels";
import { Await, Chips, Kpi, NoRows, Page, RoleButton, Table, Tabs, td, useFail } from "./ui";

const RANGES = [{ key: "12", label: "12 weeks" }, { key: "26", label: "26 weeks" }, { key: "52", label: "52 weeks" }] as const;
type Range = (typeof RANGES)[number]["key"];
const TABS = [{ key: "growth", label: "Growth" }, { key: "revenue", label: "Revenue" }, { key: "usage", label: "Usage" }, { key: "where", label: "Where" }, { key: "top", label: "Top companies" }, { key: "retention", label: "Retention" }] as const;
type Tab = (typeof TABS)[number]["key"];

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel" style={{ padding: 14, display: "grid", gap: 8, alignContent: "start" }} aria-label={title}><h2 style={{ fontSize: 16 }}>{title}</h2>{children}</section>;
}

export default function Analytics() {
  const [range, setRange] = useState<Range>("12");
  const [tab, setTab] = useState<Tab>("growth");
  const toast = useToast();
  const fail = useFail();
  const q = useQuery({ queryKey: ["staff-analytics", range], queryFn: () => sa.analytics(Number(range)), placeholderData: (p) => p });
  return (
    <Page title="Business analytics" sub="How many companies join and how much the cards are used."
      actions={<RoleButton perm="export" className="btn ghost sm" onClick={() => void sa.downloadAnalytics(Number(range) * 2).catch((e) => toast(fail(e)))}>Download CSV</RoleButton>}>
      <Await q={q}>
        {(d) => {
          const labels = d.weeks.map((w) => w.week.slice(5));
          return (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                <Kpi label="Companies" value={fmtNumber(d.totals.companies)} />
                <Kpi label="Active cards" value={fmtNumber(d.totals.active_cards)} />
                <Kpi label="Views, last 30 days" value={fmtNumber(d.totals.views_30d)} />
                <Kpi label="Leads, last 30 days" value={fmtNumber(d.totals.leads_30d)} />
              </div>
              <Tabs tabs={TABS} value={tab} onChange={setTab} />
              {tab !== "where" && tab !== "top" && tab !== "retention" && tab !== "revenue" && <Chips items={RANGES} value={range} onChange={setRange} />}
              {tab === "growth" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
                    <Panel title="New companies per week"><BarChart label="New companies per week" data={d.weeks.map((w) => ({ label: w.week.slice(5), value: w.new_companies }))} /></Panel>
                    <Panel title="New cards per week"><BarChart label="New cards per week" color="#10B981" data={d.weeks.map((w) => ({ label: w.week.slice(5), value: w.new_cards }))} /></Panel>
                  </div>
                  <Panel title="Active cards over time">
                    <LineChart label="Active cards, running total" labels={d.active_cards.map((w) => w.week.slice(5))} series={[{ name: "Active cards", values: d.active_cards.map((w) => w.n), color: "#10B981" }]} />
                    <p className="hint" style={{ margin: 0 }}>Cards that are live now, counted from the week each was made. A card that was live earlier and has been taken down since is not in this line.</p>
                  </Panel>
                </>
              )}
              {tab === "revenue" && (
                <>
                  <MoneyKpis m={d.money} />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
                    <Funnel m={d.money} />
                    <Revenue m={d.money} />
                  </div>
                </>
              )}
              {tab === "usage" && (
                <Panel title="Views, scans, saves and leads per week">
                  <LineChart label="Views, scans, saves and leads per week" labels={labels} series={[
                    { name: "Views", values: d.weeks.map((w) => w.views) }, { name: "Scans", values: d.weeks.map((w) => w.scans) },
                    { name: "Saves", values: d.weeks.map((w) => w.saves) }, { name: "Leads", values: d.weeks.map((w) => w.leads) },
                  ]} />
                </Panel>
              )}
              {tab === "where" && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
                  <Panel title="Views by country, last 90 days"><HBars rows={d.countries.map((c) => ({ label: c.country, value: c.views }))} format={fmtNumber} /></Panel>
                  <Panel title="Companies by country (own country, else guessed from visitors)">
                    <HBars color="#10B981" rows={d.company_countries.map((c) => ({ label: `${countryName(c.country, "en")}${c.guessed ? ` (${c.guessed} guessed)` : ""}`, value: c.companies }))} />
                  </Panel>
                  <Panel title="Companies by size (people)"><HBars color="#3B82F6" rows={d.sizes.map((s) => ({ label: s.label, value: s.companies }))} /></Panel>
                </div>
              )}
              {tab === "top" && (
                <Panel title="Top companies by views, last 30 days"><HBars rows={d.top_companies.map((c) => ({ label: c.name, value: c.views }))} format={fmtNumber} /></Panel>
              )}
              {tab === "retention" && (
                <>
                  <Panel title="Retention by month joined">
                    <p className="hint" style={{ margin: 0 }}>Share of the companies that joined in a month whose cards had visits in that month (month 0) and in each of the next three months. A dash means that month has not finished yet.</p>
                    {d.retention_monthly.every((r) => r.companies === 0) ? <NoRows>No company joined in the last six months.</NoRows> : (
                      <Table head={["Joined in", "Companies", "Month 0", "Month 1", "Month 2", "Month 3"]}>
                        {d.retention_monthly.map((r) => (
                          <tr key={r.month}><td style={td}>{monthLabel(r.month)}</td><td style={td}>{r.companies}</td>{["0", "1", "2", "3"].map((k) => <td key={k} style={td}>{r.after[k] == null ? "-" : <b>{r.after[k]}%</b>}</td>)}</tr>
                        ))}
                      </Table>
                    )}
                  </Panel>
                  <Panel title="Retention by signup week">
                    <p className="hint" style={{ margin: 0 }}>Share of the companies that joined that week whose cards still had visits 1, 4 and 8 weeks later. A dash means that much time has not passed yet.</p>
                    <Table head={["Joined in week of", "Companies", "After 1 week", "After 4 weeks", "After 8 weeks"]}>
                      {d.retention.map((r) => (
                        <tr key={r.week}><td style={td}>{r.week}</td><td style={td}>{r.companies}</td>{["1", "4", "8"].map((k) => <td key={k} style={td}>{r.after[k] == null ? "-" : <b>{r.after[k]}%</b>}</td>)}</tr>
                      ))}
                    </Table>
                  </Panel>
                </>
              )}
            </>
          );
        }}
      </Await>
    </Page>
  );
}
