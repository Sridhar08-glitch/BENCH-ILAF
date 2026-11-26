"use client";

import { useI18n } from "@/lib/i18n/client";
import { CountedField, SectionTitle } from "./SectionTitle";
import type { SectionFormProps } from "./types";

/** An ISO date-time as the value of a datetime-local field (in the browser's own zone), or "" when it is not a date. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The value of a datetime-local field as an ISO date-time, or "" when empty or not a date. */
export function fromLocalInput(local: string): string {
  if (!local) return "";
  const t = new Date(local).getTime();
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

export function EventForm({ section, onChange, disabled }: SectionFormProps<"event">) {
  const { t } = useI18n();
  const d = section.data;
  const set = (patch: Partial<typeof d>) => onChange({ ...d, ...patch });
  return (
    <>
      <SectionTitle value={d.title} disabled={disabled} onChange={(title) => set({ title })} placeholder={t("content.defEvent")} />
      <CountedField label={t("content.eventName")} value={d.event_name} max={120} disabled={disabled} onChange={(event_name) => set({ event_name })} />
      <div className="two">
        <label>
          {t("content.startsAt")}
          <input type="datetime-local" className="ltr" value={toLocalInput(d.starts_at)} disabled={disabled} onChange={(e) => set({ starts_at: fromLocalInput(e.target.value) })} />
        </label>
        <label>
          {t("content.endsAt")}
          <input type="datetime-local" className="ltr" value={toLocalInput(d.ends_at)} disabled={disabled} onChange={(e) => set({ ends_at: fromLocalInput(e.target.value) || null })} />
        </label>
      </div>
      <CountedField label={t("content.venue")} value={d.venue} max={120} disabled={disabled} onChange={(venue) => set({ venue })} />
      <div className="two">
        <CountedField label={t("content.hall")} value={d.hall} max={60} disabled={disabled} onChange={(hall) => set({ hall })} />
        <CountedField label={t("content.stand")} value={d.stand} max={40} disabled={disabled} onChange={(stand) => set({ stand })} />
      </div>
      <CountedField label={t("content.talkTitle")} value={d.talk_title} max={120} disabled={disabled} hint={t("content.talkTitleHint")} onChange={(talk_title) => set({ talk_title })} />
      <CountedField label={t("content.talkTime")} value={d.talk_time} max={40} disabled={disabled} hint={t("content.talkTimeHint")} onChange={(talk_time) => set({ talk_time })} />
      <CountedField label={t("content.slidesUrl")} value={d.slides_url} max={500} type="url" dir="ltr" placeholder="https://" disabled={disabled} hint={t("content.slidesHint")} onChange={(slides_url) => set({ slides_url })} />
    </>
  );
}
