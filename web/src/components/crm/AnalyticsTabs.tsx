"use client";

// The five Analytics tabs. Each tab asks the API for its own numbers for the chosen range.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Bars, COLORS, HoursChart, delta } from "@/components/app/charts";
import { Empty, ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import { crm } from "@/lib/crm/api";
import { isolateLtr } from "@/lib/crm/bidi";
import { COLUMNS, changePct, changeText, conversion, downloadCsv, percentText, sortRows, toCsv, type Dir, type SortKey } from "@/lib/crm/analytics";
import type { AnalyticsQuery, DepartmentRow, LinkRow, Metrics, PersonRow, SourceKey } from "@/lib/crm/types";
import { platformName } from "@/lib/card/catalogue";
import { useI18n } from "@/lib/i18n/client";
import { tk, type MessageKey } from "@/lib/i18n";
import type { Totals } from "@/lib/types";
import { RankBars, StackedBars, TimeChart } from "./charts";
import s from "./crm.module.css";

export interface TabProps {
  ws: string;
  q: AnalyticsQuery;
  group: "day" | "week" | "month";
  cardId: string;
}

const SOURCE_NAMES: Record<SourceKey, MessageKey> = {
  nfc: tk("analytics.srcNfc"), qr: tk("analytics.srcQr"), link: tk("analytics.srcLink"), email: tk("analytics.srcEmail"), other: tk("analytics.srcOther"),
};
const SOURCE_COLORS: Record<SourceKey, string> = { qr: "#FF6B35", nfc: "#3B82F6", link: "#10B981", email: "#101114", other: "#B7BBC3" };
const TOTALS: { k: keyof Totals; t: MessageKey; icon: string }[] = [
  { k: "views", t: tk("analytics.colViews"), icon: "eye" },
  { k: "unique_visitors", t: tk("analytics.totUnique"), icon: "users" },
  { k: "scans", t: tk("analytics.colScans"), icon: "scan" },
  { k: "taps", t: tk("analytics.totTaps"), icon: "nfc" },
  { k: "saves", t: tk("analytics.totSaves"), icon: "adduser" },
  { k: "leads", t: tk("analytics.totLeads"), icon: "user" },
  { k: "link_clicks", t: tk("analytics.totClicks"), icon: "tap" },
];
const PER_GROUP = { day: tk("analytics.perDay"), week: tk("analytics.perWeek"), month: tk("analytics.perMonth") } as const;

function Delta({ now, prev }: { now: number; prev: number }) {
  const i18n = useI18n();
  const p = changePct(now, prev);
  const cls = p === null ? (now > 0 ? s.up : s.flat) : p > 0 ? s.up : p < 0 ? s.dn : s.flat;
  return <span className={`${s.delta} ${cls}`}>{changeText(now, prev, i18n)}</span>;
}

function Loading({ q, children }: { q: { isLoading: boolean; error: unknown; refetch: () => unknown }; children: React.ReactNode }) {
  if (q.isLoading) return <SkeletonBlocks rows={4} />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  return <>{children}</>;
}

function ExportButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return <button type="button" className="btn ghost sm" onClick={onClick}><Icon name="download" size="s" />{t("analytics.exportTable")}</button>;
}

function SortHead({ title, k, sort, dir, onSort, num }: { title: string; k: SortKey; sort: SortKey; dir: Dir; onSort: (k: SortKey) => void; num?: boolean }) {
  const { t } = useI18n();
  const active = sort === k;
  const aria = active ? t(dir === "asc" ? "analytics.sortAsc" : "analytics.sortDesc", { title }) : t("analytics.sortBy", { title });
  return (
    <span className={num ? s.num : undefined}>
      <button type="button" className={s.sortBtn} data-active={active} aria-label={aria} onClick={() => onSort(k)}>
        {title}{active ? (dir === "asc" ? " ▲" : " ▼") : ""}
      </button>
    </span>
  );
}

function useSort(initial: SortKey = "views") {
  const [sort, setSort] = useState<SortKey>(initial);
  const [dir, setDir] = useState<Dir>("desc");
  const onSort = (k: SortKey) => {
    if (k === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setDir(k === "name" ? "asc" : "desc");
    }
  };
  return { sort, dir, onSort };
}

/** A country code from the API shown as the country's name in the reader's language. */
function useCountryName() {
  const { tag, t } = useI18n();
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([tag], { type: "region" });
    } catch {
      return null;
    }
  }, [tag]);
  return (code: string) => {
    if (code === "unknown") return t("analytics.unknown");
    if (!/^[A-Za-z]{2}$/.test(code)) return code;
    try {
      return names?.of(code.toUpperCase()) ?? code;
    } catch {
      return code;
    }
  };
}

// ------------------------------------------------------------------ overview
export function OverviewTab({ ws, q, group, cardId }: TabProps) {
  const { t, number } = useI18n();
  const countryName = useCountryName();
  const a = useQuery({ queryKey: ["analytics", ws, q, group, cardId], queryFn: () => crm.overview(ws, { ...q, group, card_id: cardId || undefined }) });
  const d = a.data;
  const deviceName = (key: string) => (key === "ios" ? "iPhone" : key === "android" ? "Android" : key === "desktop" ? t("analytics.devDesktop") : t("analytics.srcOther"));
  return (
    <Loading q={a}>
      {d && (
        <>
          <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
            {TOTALS.map((tot) => {
              const x = delta(d.totals[tot.k], d.prev_totals[tot.k], { t, number });
              return (
                <div className="panel kpi" key={tot.k}>
                  <div className="t"><span>{t(tot.t)}</span><span className="chip"><Icon name={tot.icon} size="s" /></span></div>
                  <b>{number(d.totals[tot.k])}</b>
                  <span className={`d ${x.up ? "up" : "dn"}`}>{x.up ? "▲" : "▼"} {x.text}</span>
                </div>
              );
            })}
          </div>
          <div className="panel card">
            <div className="head"><h2><span className="chip"><Icon name="chart" size="s" /></span>{t("analytics.activity")}</h2><span className="hint">{t(PER_GROUP[group])}</span></div>
            {d.series.length > 0 ? (
              <TimeChart
                label={t("analytics.chartLabel")}
                dates={d.series.map((x) => x.date)}
                group={group}
                series={[
                  { key: "views", label: t("analytics.colViews"), color: COLORS.orange, values: d.series.map((x) => x.views) },
                  { key: "saves", label: t("analytics.colSaves"), color: COLORS.blue, values: d.series.map((x) => x.saves) },
                  { key: "leads", label: t("analytics.seriesContacts"), color: COLORS.green, values: d.series.map((x) => x.leads) },
                ]}
              />
            ) : <Empty title={t("analytics.noActivity")}>{t("analytics.noActivityText")}</Empty>}
          </div>
          <div className="g3">
            <div className="panel card">
              <div className="head"><h2><span className="chip"><Icon name="pin" size="s" /></span>{t("analytics.topCountries")}</h2></div>
              <Bars rows={d.locations.slice(0, 8).map((l) => ({ label: countryName(l.country), value: l.count, icon: "pin" }))} />
            </div>
            <div className="panel card">
              <div className="head"><h2><span className="chip accent"><Icon name="phone" size="s" /></span>{t("analytics.devices")}</h2></div>
              <Bars rows={d.devices.map((x) => ({ label: deviceName(x.key), value: x.count, icon: "phone" }))} />
            </div>
            <div className="panel card">
              <div className="head"><h2><span className="chip"><Icon name="tap" size="s" /></span>{t("analytics.topButtons")}</h2></div>
              <Bars rows={d.top_buttons.slice(0, 8).map((b) => ({ label: platformName(b.kind, t), value: b.count }))} empty={t("analytics.noButtonClicks")} />
            </div>
          </div>
          <div className="panel card">
            <div className="head"><h2><span className="chip"><Icon name="clock" size="s" /></span>{t("analytics.viewsByHour")}</h2><span className="hint">{t("analytics.inZone", { tz: isolateLtr(d.period?.tz ?? "UTC") })}</span></div>
            <HoursChart hours={d.hours} />
          </div>
        </>
      )}
    </Loading>
  );
}

// ------------------------------------------------------------------ people
export function PeopleTab({ ws, q }: TabProps) {
  const { t, number, date } = useI18n();
  const [by, setBy] = useState<"person" | "card">("person");
  const { sort, dir, onSort } = useSort("views");
  const r = useQuery({ queryKey: ["analytics-people", ws, q, by], queryFn: () => crm.people(ws, { ...q, by }) });
  const toast = useToast();
  const rows = useMemo(() => sortRows(r.data?.rows ?? [], sort, dir), [r.data, sort, dir]);
  const cols = "28px minmax(0,1.7fr) repeat(6,minmax(64px,1fr)) 70px";
  const top = rows.slice(0, 3).filter((x) => x.totals.views > 0);

  function exportCsv() {
    if (!r.data) return toast(t("analytics.nothingToExport"));
    downloadCsv(`analytics-${by === "card" ? "cards" : "people"}.csv`, toCsv(
      [by === "card" ? t("analytics.colCard") : t("analytics.colPerson"), t("analytics.colDepartment"), ...COLUMNS.map((c) => t(c.t)), t("analytics.csvLeadsPer100"), ...COLUMNS.map((c) => t("analytics.csvPrev", { name: t(c.t) }))],
      rows.map((x) => [x.name, x.department ?? "", ...COLUMNS.map((c) => x.totals[c.k]), conversion(x.totals), ...COLUMNS.map((c) => x.prev[c.k])]),
    ));
  }
  return (
    <Loading q={r}>
      <div className="panel card">
        <div className="head">
          <h2><span className="chip"><Icon name="users" size="s" /></span>{t("analytics.topPerformers")}</h2>
          <div className="row">
            <div className="seg" role="group" aria-label={t("analytics.groupBy")}>
              <button type="button" aria-pressed={by === "person"} onClick={() => setBy("person")}>{t("analytics.byPeople")}</button>
              <button type="button" aria-pressed={by === "card"} onClick={() => setBy("card")}>{t("analytics.byCards")}</button>
            </div>
            <ExportButton onClick={exportCsv} />
          </div>
        </div>
        {top.length > 0 && (
          <div className="g3">
            {top.map((x, i) => (
              <div className="panel kpi" key={x.key}>
                <div className="t"><span>{t("analytics.rankByViews", { rank: number(i + 1) })}</span><span className="pill accent">{t("analytics.toLeads", { pct: percentText(conversion(x.totals), number) })}</span></div>
                <b dir="auto" style={{ fontSize: 22 }}>{x.name}</b>
                <span className="hint">{[t("analytics.nViews", { n: x.totals.views }), x.leads_visible === false ? "" : t("analytics.nLeads", { n: x.totals.leads }), x.department ?? ""].filter(Boolean).join(" · ")}</span>
              </div>
            ))}
          </div>
        )}
        {rows.length === 0 ? <Empty title={t("analytics.noData")}>{t("analytics.noDataText")}</Empty> : (
          <div className={s.scroll}>
            <div className={s.table}>
              <div className="trow h keep" style={{ ["--cols" as string]: cols }}>
                <span>#</span>
                <SortHead title={by === "card" ? t("analytics.colCard") : t("analytics.colPerson")} k="name" sort={sort} dir={dir} onSort={onSort} />
                {COLUMNS.map((c) => <SortHead key={c.k} title={t(c.t)} k={c.k} sort={sort} dir={dir} onSort={onSort} num />)}
                <SortHead title={t("analytics.leadPct")} k="conversion" sort={sort} dir={dir} onSort={onSort} num />
              </div>
              {rows.map((x: PersonRow, i) => (
                <div className="trow keep" key={x.key} style={{ ["--cols" as string]: cols }}>
                  <span className="hint">{number(i + 1)}</span>
                  <div style={{ minWidth: 0 }}><b dir="auto" style={{ overflowWrap: "anywhere" }}>{x.name}</b>{(x.department || by === "card") && <div className="hint" dir="auto">{by === "card" ? x.person : x.department}{by === "card" && x.department ? ` · ${x.department}` : ""}</div>}</div>
                  {COLUMNS.map((c) => (c.k === "leads" && x.leads_visible === false ? <span className={s.num} key={c.k} title={t("analytics.contactsHidden")}>&ndash;</span> : <span className={s.num} key={c.k}>{number(x.totals[c.k])}<Delta now={x.totals[c.k]} prev={x.prev[c.k]} /></span>))}
                  <span className={s.num}>{x.leads_visible === false ? <>&ndash;</> : percentText(conversion(x.totals), number)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {r.data && <p className={s.noteLine}>{t("analytics.peopleNote", { period: t("analytics.rangeDays", { days: r.data.period.days }), date: date(r.data.period.prev_from) })}</p>}
      </div>
    </Loading>
  );
}

// ------------------------------------------------------------------ departments
export function DepartmentsTab({ ws, q }: TabProps) {
  const { t, number } = useI18n();
  const { sort, dir, onSort } = useSort("views");
  const r = useQuery({ queryKey: ["analytics-departments", ws, q], queryFn: () => crm.departments(ws, q) });
  const toast = useToast();
  const rows = useMemo(() => sortRows(r.data?.rows ?? [], sort, dir), [r.data, sort, dir]);
  const cols = "minmax(0,1.5fr) 64px repeat(6,minmax(64px,1fr)) minmax(0,1.2fr)";
  function exportCsv() {
    if (!r.data) return toast(t("analytics.nothingToExport"));
    downloadCsv("analytics-departments.csv", toCsv(
      [t("analytics.colDepartment"), t("analytics.colPeople"), t("analytics.colCards"), ...COLUMNS.map((c) => t(c.t)), t("analytics.colTopPerson"), ...COLUMNS.map((c) => t("analytics.csvPrev", { name: t(c.t) }))],
      rows.map((x) => [x.name, x.people, x.cards, ...COLUMNS.map((c) => x.totals[c.k]), x.top_person?.name ?? "", ...COLUMNS.map((c) => x.prev[c.k])]),
    ));
  }
  return (
    <Loading q={r}>
      <div className="g2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="eye" size="s" /></span>{t("analytics.viewsByDept")}</h2></div>
          <RankBars rows={(r.data?.rows ?? []).map((x) => ({ label: x.name, value: x.totals.views }))} empty={t("analytics.noViewsRange")} />
        </div>
        <div className="panel card">
          <div className="head"><h2><span className="chip ok"><Icon name="user" size="s" /></span>{t("analytics.leadsByDept")}</h2></div>
          <RankBars rows={[...(r.data?.rows ?? [])].sort((a, b) => b.totals.leads - a.totals.leads).map((x) => ({ label: x.name, value: x.totals.leads }))} color={COLORS.green} empty={t("analytics.noLeadsRange")} />
        </div>
      </div>
      <div className="panel card">
        <div className="head"><h2><span className="chip"><Icon name="users" size="s" /></span>{t("analytics.deptSummary")}</h2><ExportButton onClick={exportCsv} /></div>
        {rows.length === 0 ? <Empty title={t("analytics.noDepts")}>{t("analytics.noDeptsText")}</Empty> : (
          <div className={s.scroll}>
            <div className={s.table}>
              <div className="trow h keep" style={{ ["--cols" as string]: cols }}>
                <SortHead title={t("analytics.colDepartment")} k="name" sort={sort} dir={dir} onSort={onSort} />
                <span className={s.num}>{t("analytics.colPeople")}</span>
                {COLUMNS.map((c) => <SortHead key={c.k} title={t(c.t)} k={c.k} sort={sort} dir={dir} onSort={onSort} num />)}
                <span>{t("analytics.colTopPerson")}</span>
              </div>
              {rows.map((x: DepartmentRow) => (
                <div className="trow keep" key={x.id ?? "none"} style={{ ["--cols" as string]: cols }}>
                  <b dir="auto" style={{ overflowWrap: "anywhere" }}>{x.name}</b>
                  <span className={s.num}>{number(x.people)}</span>
                  {COLUMNS.map((c) => <span className={s.num} key={c.k}>{number(x.totals[c.k])}<Delta now={x.totals[c.k]} prev={x.prev[c.k]} /></span>)}
                  <span className="hint" dir="auto">{x.top_person ? `${x.top_person.name} (${number(x.top_person.views)})` : "-"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Loading>
  );
}

// ------------------------------------------------------------------ links
export function LinksTab({ ws, q }: TabProps) {
  const { t, number } = useI18n();
  const r = useQuery({ queryKey: ["analytics-links", ws, q], queryFn: () => crm.links(ws, q) });
  const toast = useToast();
  const rows = r.data?.rows ?? [];
  const cols = "minmax(0,1.3fr) 90px 70px 90px minmax(0,1.4fr)";
  function exportCsv() {
    if (!r.data) return toast(t("analytics.nothingToExport"));
    downloadCsv("analytics-links.csv", toCsv(
      [t("analytics.colButton"), t("analytics.colClicks"), t("analytics.csvPrev", { name: t("analytics.colClicks") }), t("analytics.csvShare"), t("analytics.colVisitors"), t("analytics.csvTopCard"), t("analytics.csvTopCardClicks")],
      rows.map((x: LinkRow) => [platformName(x.kind, t), x.clicks, x.prev_clicks, x.share, x.visitors, x.top_card?.name ?? "", x.top_card?.clicks ?? ""]),
    ));
  }
  return (
    <Loading q={r}>
      <div className="g2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr)" }}>
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="tap" size="s" /></span>{t("analytics.leaderboard")}</h2><span className="pill">{t("analytics.nClicks", { n: r.data?.total ?? 0 })}</span></div>
          <RankBars rows={rows.slice(0, 10).map((x) => ({ label: platformName(x.kind, t), value: x.clicks }))} empty={t("analytics.noClicksRange")} />
        </div>
        <div className="panel card">
          <div className="head"><h2><span className="chip accent"><Icon name="chart" size="s" /></span>{t("analytics.details")}</h2><ExportButton onClick={exportCsv} /></div>
          {rows.length === 0 ? <p className="hint">{t("analytics.noClicksRange")}</p> : (
            <div className={s.scroll}>
              <div style={{ minWidth: 520 }}>
                <div className="trow h keep" style={{ ["--cols" as string]: cols }}><span>{t("analytics.colButton")}</span><span className={s.num}>{t("analytics.colClicks")}</span><span className={s.num}>{t("analytics.colShare")}</span><span className={s.num}>{t("analytics.colVisitors")}</span><span>{t("analytics.colMostOn")}</span></div>
                {rows.map((x) => (
                  <div className="trow keep" key={x.kind} style={{ ["--cols" as string]: cols }}>
                    <b>{platformName(x.kind, t)}</b>
                    <span className={s.num}>{number(x.clicks)}<Delta now={x.clicks} prev={x.prev_clicks} /></span>
                    <span className={s.num}>{percentText(x.share, number)}</span>
                    <span className={s.num}>{number(x.visitors)}</span>
                    <span className="hint" dir="auto">{x.top_card ? `${x.top_card.name} (${number(x.top_card.clicks)})` : "-"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Loading>
  );
}

// ------------------------------------------------------------------ sources
export function SourcesTab({ ws, q, group }: TabProps) {
  const { t, number } = useI18n();
  const r = useQuery({ queryKey: ["analytics-sources", ws, q, group], queryFn: () => crm.sources(ws, { ...q, group }) });
  const toast = useToast();
  const d = r.data;
  const cols = "minmax(0,1.3fr) 90px 70px 80px 80px 90px";
  const per100 = (x: { views: number; leads: number }) => (x.views ? Math.round((x.leads / x.views) * 1000) / 10 : 0);
  function exportCsv() {
    if (!d) return toast(t("analytics.nothingToExport"));
    downloadCsv("analytics-sources.csv", toCsv(
      [t("analytics.colSource"), t("analytics.colViews"), t("analytics.csvPrev", { name: t("analytics.colViews") }), t("analytics.csvShare"), t("analytics.colSaves"), t("analytics.colLeads"), t("analytics.csvLeadsPer100")],
      d.rows.map((x) => [t(SOURCE_NAMES[x.key]), x.views, x.prev_views, x.share, x.saves, x.leads, per100(x)]),
    ));
  }
  return (
    <Loading q={r}>
      {d && (
        <>
          <div className="panel card">
            <div className="head"><h2><span className="chip"><Icon name="scan" size="s" /></span>{t("analytics.howOpened")}</h2><span className="hint">{t(PER_GROUP[group])}</span></div>
            {d.total > 0 ? (
              <StackedBars
                label={t("analytics.viewsBySource")}
                dates={d.series.map((x) => x.date)}
                group={group}
                series={(["qr", "nfc", "link", "email", "other"] as SourceKey[]).map((k) => ({ key: k, label: t(SOURCE_NAMES[k]), color: SOURCE_COLORS[k], values: d.series.map((x) => x[k]) }))}
              />
            ) : <Empty title={t("analytics.noViewsTitle")} />}
          </div>
          <div className="panel card">
            <div className="head"><h2><span className="chip accent"><Icon name="chart" size="s" /></span>{t("analytics.sourceComparison")}</h2><ExportButton onClick={exportCsv} /></div>
            <div className={s.scroll}>
              <div style={{ minWidth: 560 }}>
                <div className="trow h keep" style={{ ["--cols" as string]: cols }}><span>{t("analytics.colSource")}</span><span className={s.num}>{t("analytics.colViews")}</span><span className={s.num}>{t("analytics.colShare")}</span><span className={s.num}>{t("analytics.colSaves")}</span><span className={s.num}>{t("analytics.colLeads")}</span><span className={s.num}>{t("analytics.colLeadsPer100")}</span></div>
                {d.rows.map((x) => (
                  <div className="trow keep" key={x.key} style={{ ["--cols" as string]: cols }}>
                    <b><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: SOURCE_COLORS[x.key], marginInlineEnd: 8 }} />{t(SOURCE_NAMES[x.key])}</b>
                    <span className={s.num}>{number(x.views)}<Delta now={x.views} prev={x.prev_views} /></span>
                    <span className={s.num}>{percentText(x.share, number)}</span>
                    <span className={s.num}>{number(x.saves)}</span>
                    <span className={s.num}>{number(x.leads)}</span>
                    <span className={s.num}>{number(per100(x))}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className={s.noteLine}>{t("analytics.sourcesNote")}</p>
          </div>
        </>
      )}
    </Loading>
  );
}

export type { Metrics };
