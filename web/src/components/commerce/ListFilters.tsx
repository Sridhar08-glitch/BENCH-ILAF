"use client";

import { Icon } from "@/components/Icon";
import s from "@/components/crm/crm.module.css";
import { NO_FILTERS, filterCount, rangeProblem, type ListFilters } from "@/lib/commerce/orders";
import { useI18n } from "@/lib/i18n/client";

/** The search box, status, card and date range shared by the orders and the bookings list. */
export function ListFiltersBar({ value, onChange, statuses, cards, searchLabel }: {
  value: ListFilters;
  onChange: (next: ListFilters) => void;
  statuses: { id: string; name: string }[];
  cards: { id: string; name: string }[];
  searchLabel: string;
}) {
  const { t } = useI18n();
  const set = <K extends keyof ListFilters>(k: K, v: ListFilters[K]) => onChange({ ...value, [k]: v });
  const n = filterCount(value);
  return (
    <>
      <div className={s.filters}>
        <label className={`search ${s.grow2}`} style={{ flexDirection: "row" }}>
          <Icon name="search" size="s" />
          <input value={value.q} onChange={(e) => set("q", e.target.value)} placeholder={searchLabel} aria-label={searchLabel} dir="auto" />
        </label>
        <label>{t("commerce.filterStatus")}
          <select value={value.status} onChange={(e) => set("status", e.target.value)}>
            <option value="">{t("commerce.allStatuses")}</option>
            {statuses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        {cards.length > 1 && (
          <label>{t("commerce.filterCard")}
            <select value={value.card} onChange={(e) => set("card", e.target.value)}>
              <option value="">{t("commerce.allCards")}</option>
              {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label className={s.dateLabel}>{t("commerce.filterFrom")}<input type="date" value={value.from} max={value.to || undefined} onChange={(e) => set("from", e.target.value)} /></label>
        <label className={s.dateLabel}>{t("commerce.filterTo")}<input type="date" value={value.to} min={value.from || undefined} onChange={(e) => set("to", e.target.value)} /></label>
        {n > 0 && <button type="button" className="btn ghost sm" onClick={() => onChange(NO_FILTERS)}>{t("commerce.clearFilters")}</button>}
      </div>
      {rangeProblem(value) && <span className="err" role="alert">{t("commerce.rangeBad")}</span>}
    </>
  );
}
