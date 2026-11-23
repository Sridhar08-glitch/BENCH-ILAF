"use client";

// Business analytics: growth, usage over time, countries, company sizes, top companies and simple retention. CSV for support and admin.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { sa } from "@/lib/staff-admin/api";
import { countryName } from "@/lib/countries";
import { fmtNumber } from "@/lib/staff-admin/format";
import { BarChart, HBars, LineChart } from "./charts";
import { Await, Chips, Page, RoleButton, Table, td, useFail } from "./ui";

const RANGES = [{ key: "12", label: "12 weeks" }, { key: "26", label: "26 weeks" }, { key: "52", label: "52 weeks" }] as const;
type Range = (typeof RANGES)[number]["key"];

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel" style={{ padding: 14, display: "grid", gap: 8, alignContent: "start" }} aria-label={title}><h2 style={{ fontSize: 16 }}>{title}</h2>{children}</section>;
}

export default function Analytics() {
  const [range, setRange] = useState<Range>("12");
  const toast = useToast();
  const fail = useFail();
  const q = useQuery({ queryKey: ["staff-analytics", range], queryFn: () => sa.analytics(Number(range)) });
  return (
    <Page title="Business analytics" sub="How many companies join and how much the cards are used."
      actions={<RoleButton perm="export" className="btn ghost sm" onClick={() => void sa.downloadAnalytics(Number(range) * 2).catch((e) => toast(fail(e)))}>Download CSV</RoleButton>}>
      <Chips items={RANGES} value={range} onChange={setRange} />
      <Await q={q}>
        {(d) => {
          const labels = d.weeks.map((w) => w.week.slice(5));
          return (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
                <Panel title="New companies per week"><BarChart label="New companies per week" data={d.weeks.map((w) => ({ label: w.week.slice(5), value: w.new_companies }))} /></Panel>
                <Panel title="New cards per week"><BarChart label="New cards per week" color="#10B981" data={d.weeks.map((w) => ({ label: w.week.slice(5), value: w.new_cards }))} /></Panel>
              </div>
              <Panel title="Views, scans, saves and leads per week">
                <LineChart label="Views, scans, saves and leads per week" labels={labels} series={[
                  { name: "Views", values: d.weeks.map((w) => w.views) }, { name: "Scans", values: d.weeks.map((w) => w.scans) },
                  { name: "Saves", values: d.weeks.map((w) => w.saves) }, { name: "Leads", values: d.weeks.map((w) => w.leads) },
                ]} />
              </Panel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
                <Panel title="Views by country, last 90 days"><HBars rows={d.countries.map((c) => ({ label: c.country, value: c.views }))} format={fmtNumber} /></Panel>
                <Panel title="Companies by country (own country, else guessed from visitors)">
                  <HBars color="#10B981" rows={d.company_countries.map((c) => ({ label: `${countryName(c.country, "en")}${c.guessed ? ` (${c.guessed} guessed)` : ""}`, value: c.companies }))} />
                </Panel>
                <Panel title="Companies by size (people)"><HBars color="#3B82F6" rows={d.sizes.map((s) => ({ label: s.label, value: s.companies }))} /></Panel>
                <Panel title="Top companies by views, last 30 days"><HBars rows={d.top_companies.map((c) => ({ label: c.name, value: c.views }))} format={fmtNumber} /></Panel>
              </div>
              <Panel title="Retention by signup week">
                <p className="hint" style={{ margin: 0 }}>Share of the companies that joined that week whose cards still had visits 1, 4 and 8 weeks later. A dash means that much time has not passed yet.</p>
                <Table head={["Joined in week of", "Companies", "After 1 week", "After 4 weeks", "After 8 weeks"]}>
                  {d.retention.map((r) => (
                    <tr key={r.week}><td style={td}>{r.week}</td><td style={td}>{r.companies}</td>{["1", "4", "8"].map((k) => <td key={k} style={td}>{r.after[k] == null ? "-" : <b>{r.after[k]}%</b>}</td>)}</tr>
                  ))}
                </Table>
              </Panel>
            </>
          );
        }}
      </Await>
    </Page>
  );
}
