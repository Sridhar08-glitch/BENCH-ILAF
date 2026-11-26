"use client";

import { useI18n } from "@/lib/i18n/client";
import c from "./content.module.css";

export const MAX_TITLE = 80;

/** The heading of a block, with a counter. Empty means the block's usual heading in the visitor's language. */
export function SectionTitle({ value, onChange, disabled, placeholder }: { value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  const { t, number } = useI18n();
  return (
    <label>
      <span className={c.lblrow}>{t("content.titleLabel")}<span className={c.counter}>{t("content.counter", { n: number(value.length), max: number(MAX_TITLE) })}</span></span>
      <input dir="auto" value={value} maxLength={MAX_TITLE} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <span className="hint">{t("content.titleHint")}</span>
    </label>
  );
}

/** A plain text field with a length counter, used by the event and map forms. */
export function CountedField({ label, value, max, onChange, disabled, hint, multiline, type, placeholder, dir }: {
  label: string; value: string; max: number; onChange: (v: string) => void; disabled?: boolean; hint?: string; multiline?: boolean; type?: string; placeholder?: string; dir?: "auto" | "ltr";
}) {
  const { t, number } = useI18n();
  return (
    <label>
      <span className={c.lblrow}>{label}<span className={c.counter}>{t("content.counter", { n: number(value.length), max: number(max) })}</span></span>
      {multiline ? (
        <textarea dir={dir ?? "auto"} value={value} maxLength={max} disabled={disabled} placeholder={placeholder} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input dir={dir ?? "auto"} className={dir === "ltr" ? "ltr" : undefined} type={type ?? "text"} value={value} maxLength={max} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
