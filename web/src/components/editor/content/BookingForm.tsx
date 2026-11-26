"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Switch } from "@/components/app/Switch";
import { useToast } from "@/components/app/ui";
import { WEEK, dayName } from "@/components/card/sections/helpers";
import { commerceApi, commerceKeys } from "@/lib/api-commerce";
import {
  BUFFER_MAX, DAYS_AHEAD_MAX, DAYS_AHEAD_MIN, DEFAULT_SETTINGS, SLOT_CHOICES, replaceWindow, weeklyProblem, windowsOf, withWindow, withoutWindow,
  type BookingSettings, type WeeklyProblem,
} from "@/lib/commerce/booking";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { safeHttps } from "@/components/card/sections/helpers";
import { CountedField, SectionTitle } from "./SectionTitle";
import { timeZones } from "./HoursForm";
import type { SectionFormProps } from "./types";
import c from "./content.module.css";

export function BookingForm({ ed, section, onChange, disabled }: SectionFormProps<"booking">) {
  const { t, locale, number } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const cardId = ed.card.id;
  const q = useQuery({ queryKey: commerceKeys.bookingSettings(cardId), queryFn: () => commerceApi.bookingSettings(cardId) });
  const [s, setS] = useState<BookingSettings | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<number>(0);
  const latest = useRef<BookingSettings | null>(null);

  // The first answer fills the form; later answers (after our own save) must not overwrite what is being typed.
  useEffect(() => {
    if (q.data && !s) {
      setS(q.data);
      latest.current = q.data;
    }
  }, [q.data, s]);

  const zones = useMemo(() => {
    const list = timeZones();
    return s?.timezone && !list.includes(s.timezone) ? [s.timezone, ...list] : list;
  }, [s?.timezone]);

  const view = s ?? DEFAULT_SETTINGS;
  const problem: WeeklyProblem = weeklyProblem(view.weekly);
  const linkBad = view.meet_link.trim() !== "" && !safeHttps(view.meet_link.trim());

  function change(patch: Partial<BookingSettings>) {
    const next = { ...(latest.current ?? DEFAULT_SETTINGS), ...patch };
    latest.current = next;
    setS(next);
    window.clearTimeout(timer.current);
    // Nothing is sent while a window is wrong or the link is not an https address; the form says what to fix.
    if (weeklyProblem(next.weekly) || (next.meet_link.trim() && !safeHttps(next.meet_link.trim()))) return;
    setState("saving");
    timer.current = window.setTimeout(async () => {
      try {
        const saved = await commerceApi.saveBookingSettings(cardId, { ...next, meet_link: next.meet_link.trim() });
        qc.setQueryData(commerceKeys.bookingSettings(cardId), saved);
        setState("saved");
      } catch (e) {
        setState("idle");
        toast(apiErrorText(e, t, "commerce.saveFailed"));
      }
    }, 900);
  }

  // Leaving the form sends what is still waiting.
  useEffect(
    () => () => {
      if (!timer.current || !latest.current) return;
      const next = latest.current;
      if (weeklyProblem(next.weekly)) return;
      window.clearTimeout(timer.current);
      void commerceApi.saveBookingSettings(cardId, next).catch(() => undefined);
    },
    [cardId],
  );

  const problemText = problem
    ? t(problem.kind === "overlap" ? "commerce.windowOverlap" : problem.kind === "order" ? "commerce.windowOrder" : "commerce.windowTime", { day: dayName(problem.d, locale) })
    : "";

  return (
    <>
      <SectionTitle value={section.data.title} disabled={disabled} onChange={(title) => onChange({ ...section.data, title })} placeholder={t("content.defBooking")} />
      {q.isLoading && <div className="skeleton" style={{ height: 120 }} />}
      {s && (
        <>
          <div className="toggle first">
            <div><b>{t("commerce.bookingOn")}</b><div className="hint">{t("commerce.bookingOnHint")}</div></div>
            <Switch checked={s.enabled} disabled={disabled} label={t("commerce.bookingOn")} onChange={(enabled) => change({ enabled })} />
          </div>
          <label>
            {t("content.timezone")}
            <select className="ltr" value={s.timezone} disabled={disabled} onChange={(e) => change({ timezone: e.target.value })}>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
          <div className="two">
            <label>
              {t("commerce.slotLength")}
              <select value={s.slot_minutes} disabled={disabled} onChange={(e) => change({ slot_minutes: Number(e.target.value) })}>
                {SLOT_CHOICES.map((m) => <option key={m} value={m}>{t("commerce.minutes", { n: number(m) })}</option>)}
              </select>
            </label>
            <label>
              {t("commerce.buffer")}
              <input className="ltr" type="number" min={0} max={BUFFER_MAX} step={5} value={s.buffer_minutes} disabled={disabled}
                onChange={(e) => change({ buffer_minutes: Math.min(BUFFER_MAX, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} />
              <span className="hint">{t("commerce.bufferHint")}</span>
            </label>
          </div>
          <label>
            {t("commerce.daysAhead")}
            <input className="ltr" type="number" min={DAYS_AHEAD_MIN} max={DAYS_AHEAD_MAX} value={s.days_ahead} disabled={disabled}
              onChange={(e) => change({ days_ahead: Math.min(DAYS_AHEAD_MAX, Math.max(DAYS_AHEAD_MIN, Math.floor(Number(e.target.value) || DAYS_AHEAD_MIN))) })} />
            <span className="hint">{t("commerce.daysAheadHint", { min: number(DAYS_AHEAD_MIN), max: number(DAYS_AHEAD_MAX) })}</span>
          </label>

          <div>
            <div className="sechead">{t("commerce.weekHours")}</div>
            {WEEK.map((d) => {
              const wins = windowsOf(s.weekly, d);
              return (
                <div key={d} className={c.day} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                  <div>
                    <b>{dayName(d, locale)}</b>
                    {wins.length === 0 && <span className={c.closed} style={{ display: "block" }}>{t("content.closedDay")}</span>}
                    {wins.map((w, i) => (
                      <div key={`${w.from}-${w.to}-${i}`} className="row" style={{ gap: 6, marginBlockStart: 6 }}>
                        <input type="time" className="ltr" value={w.from} disabled={disabled} aria-label={t("content.open")} onChange={(e) => change({ weekly: replaceWindow(s.weekly, d, i, { from: e.target.value }) })} />
                        <input type="time" className="ltr" value={w.to} disabled={disabled} aria-label={t("content.close")} onChange={(e) => change({ weekly: replaceWindow(s.weekly, d, i, { to: e.target.value }) })} />
                        <button type="button" className={c.iconbtn} disabled={disabled} aria-label={t("commerce.removeWindow", { day: dayName(d, locale) })} onClick={() => change({ weekly: withoutWindow(s.weekly, d, i) })}><Icon name="trash" size="s" /></button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className={c.iconbtn} disabled={disabled || wins.length >= 4} aria-label={t("commerce.addWindow", { day: dayName(d, locale) })} onClick={() => change({ weekly: withWindow(s.weekly, d) })}><Icon name="plus" size="s" /></button>
                </div>
              );
            })}
            {problem && <p className="hint" role="alert" style={{ color: "var(--red, #b42318)" }}>{problemText}</p>}
          </div>

          <CountedField label={t("commerce.locationNote")} value={s.location_note} max={120} disabled={disabled} hint={t("commerce.locationNoteHint")} onChange={(location_note) => change({ location_note })} />
          <label>
            {t("commerce.meetLinkLabel")}
            <input className="ltr" type="url" inputMode="url" value={s.meet_link} placeholder="https://" disabled={disabled} aria-invalid={linkBad} onChange={(e) => change({ meet_link: e.target.value })} />
            {linkBad && <span className="hint" role="alert">{t("commerce.meetLinkBad")}</span>}
          </label>
          <span className={c.status} role="status">{state === "saving" ? t("content.saving") : state === "saved" ? t("content.saved") : ""}</span>
        </>
      )}
    </>
  );
}
