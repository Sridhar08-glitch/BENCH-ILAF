"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { PageHead } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { TourButton } from "@/components/guide/TourButton";
import { DepartmentsTab, LinksTab, OverviewTab, PeopleTab, SourcesTab } from "@/components/crm/AnalyticsTabs";
import s from "@/components/crm/crm.module.css";
import { isolateLtr } from "@/lib/crm/bidi";
import { RANGES, customProblem, dayCount, defaultGroup, viewerZone } from "@/lib/crm/analytics";
import type { AnalyticsQuery } from "@/lib/crm/types";
import { useCards } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n/client";
import { tk, type MessageKey } from "@/lib/i18n";

type TabKey = "overview" | "people" | "departments" | "links" | "sources";
type Group = "day" | "week" | "month";

const GROUP_NAMES: Record<Group, MessageKey> = { day: tk("analytics.groupDays"), week: tk("analytics.groupWeeks"), month: tk("analytics.groupMonths") };

export default function AnalyticsPage() {
  const { current, isManager, isCompany } = useWs();
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>("overview");
  const [range, setRange] = useState("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
  const [groupPick, setGroupPick] = useState<Group | null>(null);
  const [card, setCard] = useState("");
  const [tz, setTz] = useState("UTC");
  const cards = useCards(current.id);
  useEffect(() => setTz(viewerZone()), []);

  const custom = range === "custom";
  const problem = custom ? customProblem(from, to, t) : null;
  const days = custom && applied ? dayCount(applied.from, applied.to) : Number(range) || 30;
  const group: Group = groupPick ?? defaultGroup(days);
  const q: AnalyticsQuery = useMemo(
    () => (custom && applied ? { from: applied.from, to: applied.to, tz } : { days: Number(range) || 30, tz }),
    [custom, applied, range, tz],
  );
  // The People and Departments tabs are for managers; the other tabs are scoped to what the caller may see.
  const tabs: { k: TabKey; t: MessageKey; icon: string }[] = [
    { k: "overview", t: tk("analytics.tabOverview"), icon: "chart" },
    ...(isManager ? [{ k: "people" as TabKey, t: tk("analytics.tabPeople"), icon: "users" }] : []),
    ...(isManager && isCompany ? [{ k: "departments" as TabKey, t: tk("analytics.tabDepartments"), icon: "card" }] : []),
    { k: "links", t: tk("analytics.tabLinks"), icon: "tap" },
    { k: "sources", t: tk("analytics.tabSources"), icon: "scan" },
  ];
  const ready = !custom || !!applied;
  const props = { ws: current.id, q, group, cardId: card };

  return (
    <div className="view">
      <PageHead title={t("analytics.title")} sub={isManager ? t("analytics.subManager") : t("analytics.subOwn")}>
        <TourButton />
        {tab === "overview" && (cards.data?.length ?? 0) > 1 && (
          <select value={card} onChange={(e) => setCard(e.target.value)} aria-label={t("analytics.card")} style={{ width: "auto", maxWidth: 240 }}>
            <option value="">{t("analytics.allCards")}</option>
            {cards.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </PageHead>

      <div className="tabs" role="tablist" aria-label={t("analytics.sections")} data-guide="analytics-tabs">
        {tabs.map((x) => (
          <button key={x.k} type="button" role="tab" className="tab" aria-selected={tab === x.k} onClick={() => setTab(x.k)}><Icon name={x.icon} size="s" />{t(x.t)}</button>
        ))}
      </div>

      <div className={s.range}>
        <div className="seg" role="group" aria-label={t("analytics.timeRange")} data-guide="analytics-range">
          {RANGES.map((r) => <button key={r.k} type="button" aria-pressed={range === r.k} onClick={() => setRange(r.k)}>{r.days ? t("analytics.rangeDays", { days: r.days }) : t("analytics.rangeCustom")}</button>)}
        </div>
        {custom && (
          <>
            <input type="date" aria-label={t("analytics.from")} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            <span className="hint">{t("analytics.toWord")}</span>
            <input type="date" aria-label={t("analytics.to")} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            <button type="button" className="btn sm" disabled={!!problem} onClick={() => setApplied({ from, to })}>{t("analytics.apply")}</button>
            {problem && (from || to) && <span className="err" role="alert">{problem}</span>}
          </>
        )}
        {(tab === "overview" || tab === "sources") && (
          <div className="seg" role="group" aria-label={t("analytics.groupBy")} style={{ marginInlineStart: "auto" }}>
            {(["day", "week", "month"] as Group[]).map((g) => <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroupPick(g)}>{t(GROUP_NAMES[g])}</button>)}
          </div>
        )}
      </div>
      <p className="hint" style={{ marginBlockStart: -8 }}>{t("analytics.zoneNote", { tz: isolateLtr(tz), period: t("analytics.rangeDays", { days }) })}</p>

      {!ready ? (
        <p className="hint">{t("analytics.pickDates")}</p>
      ) : (
        <div role="tabpanel" className="view" data-guide="analytics-body">
          {tab === "overview" && <OverviewTab {...props} />}
          {tab === "people" && isManager && <PeopleTab {...props} />}
          {tab === "departments" && isManager && <DepartmentsTab {...props} />}
          {tab === "links" && <LinksTab {...props} />}
          {tab === "sources" && <SourcesTab {...props} />}
        </div>
      )}
    </div>
  );
}
