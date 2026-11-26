import type { HoursSectionData } from "@/lib/public-api";
import { dayName, groupDays, localClock, openState } from "./helpers";
import { SectionHead } from "./Head";
import type { SectionContext } from "./types";
import s from "./sections.module.css";

/** Opening hours as one line per run of days, with today marked and an "open now" pill read in the place's own time zone. */
export function Hours({ data, ctx, now = new Date() }: { data: HoursSectionData; ctx: SectionContext; now?: Date }) {
  const { t, locale } = ctx;
  const days = Array.isArray(data.days) ? data.days : [];
  const state = openState(days, data.timezone, now);
  const today = localClock(data.timezone, now).day;
  const rows = groupDays(days);
  const pill = state.open
    ? <span className={`${s.state} ${s.on}`}><i />{state.closesAt ? t("content.openUntil", { time: state.closesAt }) : t("content.openNow")}</span>
    : <span className={s.state}><i />{state.opensAt ? t("content.opensAt", { time: state.opensAt }) : t("content.closedNow")}</span>;
  return (
    <section className={s.sec} data-section="hours">
      <SectionHead title={data.title || t("content.defHours")} right={pill} />
      <div className={`${s.panel} ${s.hours}`}>
        {rows.map((r) => {
          const isToday = today >= r.from && today <= r.to;
          const label = r.from === r.to ? dayName(r.from, locale) : t("content.dayRange", { from: dayName(r.from, locale), to: dayName(r.to, locale) });
          return (
            <div key={r.from} className={`${s.hr}${isToday ? ` ${s.today}` : ""}${r.closed ? ` ${s.off}` : ""}`}>
              <span className={s.day}>{label}{isToday && <span className={s.pill}>{t("content.today")}</span>}</span>
              <b className={s.mono}>{r.closed ? t("content.closed") : `${r.open} – ${r.close}`}</b>
            </div>
          );
        })}
      </div>
      {data.note && <p className={s.hint} dir="auto">{data.note}</p>}
    </section>
  );
}
