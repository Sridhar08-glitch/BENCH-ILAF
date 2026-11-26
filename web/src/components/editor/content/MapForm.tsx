"use client";

import { useI18n } from "@/lib/i18n/client";
import { CountedField, SectionTitle } from "./SectionTitle";
import type { SectionFormProps } from "./types";

export function MapForm({ section, onChange, disabled }: SectionFormProps<"map">) {
  const { t } = useI18n();
  const d = section.data;
  const set = (patch: Partial<typeof d>) => onChange({ ...d, ...patch });
  return (
    <>
      <SectionTitle value={d.title} disabled={disabled} onChange={(title) => set({ title })} placeholder={t("content.defMap")} />
      <CountedField label={t("content.address")} value={d.address} max={300} multiline disabled={disabled} onChange={(address) => set({ address })} />
      <CountedField label={t("content.mapsUrl")} value={d.maps_url} max={500} type="url" dir="ltr" placeholder="https://maps.app.goo.gl/..." disabled={disabled} hint={t("content.mapsHint")} onChange={(maps_url) => set({ maps_url })} />
      <CountedField label={t("content.directionsNote")} value={d.directions_note} max={80} disabled={disabled} hint={t("content.directionsNoteHint")} onChange={(directions_note) => set({ directions_note })} />
    </>
  );
}
