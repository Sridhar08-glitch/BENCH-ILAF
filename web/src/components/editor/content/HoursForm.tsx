"use client";

import { useMemo } from "react";
import { WEEK, dayName, dayOf } from "@/components/card/sections/helpers";
import { useI18n } from "@/lib/i18n/client";
import type { HoursDay } from "@/lib/public-api";
import { CountedField, SectionTitle } from "./SectionTitle";
import type { SectionFormProps } from "./types";
import c from "./content.module.css";

const FALLBACK_ZONES = [
  "Asia/Qatar", "Asia/Dubai", "Asia/Riyadh", "Asia/Kuwait", "Asia/Bahrain", "Asia/Muscat", "Africa/Cairo", "Asia/Amman", "Asia/Beirut", "Europe/Istanbul",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Karachi", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "America/New_York", "America/Los_Angeles", "UTC",
];

/** Every time zone the browser knows, or a short list where it cannot say. */
export function timeZones(): string[] {
  try {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return all.length ? all : FALLBACK_ZONES;
  } catch {
    return FALLBACK_ZONES;
  }
}

export function HoursForm({ section, onChange, disabled }: SectionFormProps<"hours">) {
  const { t, locale } = useI18n();
  const d = section.data;
  const zones = useMemo(() => {
    const list = timeZones();
    return d.timezone && !list.includes(d.timezone) ? [d.timezone, ...list] : list;
  }, [d.timezone]);
  const set = (patch: Partial<typeof d>) => onChange({ ...d, ...patch });
  const setDay = (day: number, patch: Partial<HoursDay>) => {
    const days = WEEK.map((n) => ({ ...dayOf(d.days, n), ...(n === day ? patch : {}) }));
    set({ days });
  };
  return (
    <>
      <SectionTitle value={d.title} disabled={disabled} onChange={(title) => set({ title })} placeholder={t("content.defHours")} />
      <label>
        {t("content.timezone")}
        <select className="ltr" value={d.timezone} disabled={disabled} onChange={(e) => set({ timezone: e.target.value })}>
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </label>
      <div>
        <div className="sechead">{t("content.hoursDays")}</div>
        {WEEK.map((n) => {
          const row = dayOf(d.days, n);
          return (
            <div key={n} className={c.day}>
              <span>{dayName(n, locale)}</span>
              <label className="chkrow" style={{ fontWeight: 500 }}>
                <input type="checkbox" className="chk" checked={!row.closed} disabled={disabled} aria-label={t("content.openOn", { day: dayName(n, locale) })} onChange={(e) => setDay(n, { closed: !e.target.checked })} />
              </label>
              {row.closed ? (
                <span className={c.closed}>{t("content.closedDay")}</span>
              ) : (
                <>
                  <input type="time" className="ltr" value={row.open} disabled={disabled} aria-label={t("content.open")} onChange={(e) => setDay(n, { open: e.target.value })} />
                  <input type="time" className="ltr" value={row.close} disabled={disabled} aria-label={t("content.close")} onChange={(e) => setDay(n, { close: e.target.value })} />
                </>
              )}
            </div>
          );
        })}
      </div>
      <CountedField label={t("content.note")} value={d.note} max={120} disabled={disabled} hint={t("content.noteHint")} onChange={(note) => set({ note })} />
    </>
  );
}
