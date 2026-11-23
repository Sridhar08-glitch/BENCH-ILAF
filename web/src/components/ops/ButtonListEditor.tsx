"use client";

// A plain list of buttons (kind, link or number, optional label). Used for department templates and the required buttons.
import { Icon } from "@/components/Icon";
import { useI18n } from "@/lib/i18n/client";
import { BUTTON_GROUPS } from "@/lib/card/buttons";
import { platformName, platformPlaceholder } from "@/lib/card/catalogue";
import type { ItemKind, MandatoryButton } from "@/lib/types";
import s from "./ops.module.css";

const KINDS: ItemKind[] = [...BUTTON_GROUPS.flatMap((g) => g.kinds), "Custom"];
export const MAX_LIST = 20;

export function ButtonListEditor({ items, onChange, addLabel, empty, idPrefix }: {
  items: MandatoryButton[];
  onChange: (next: MandatoryButton[]) => void;
  addLabel: string;
  empty: string;
  idPrefix: string;
}) {
  const { t } = useI18n();
  const set = (i: number, patch: Partial<MandatoryButton>) => onChange(items.map((b, n) => (n === i ? { ...b, ...patch } : b)));
  return (
    <div className={s.btnrows}>
      {items.length === 0 && <p className="hint">{empty}</p>}
      {items.map((b, i) => (
        <div className={s.btnrow} key={i}>
          <select value={b.kind} onChange={(e) => set(i, { kind: e.target.value as ItemKind })} aria-label={t("company.kindOfButton", { n: i + 1 })}>
            {KINDS.map((k) => <option key={k} value={k}>{platformName(k, t)}</option>)}
          </select>
          <input id={`${idPrefix}-v-${i}`} className="ltr" value={b.value} placeholder={platformPlaceholder(b.kind, t)} onChange={(e) => set(i, { value: e.target.value })} aria-label={t("company.linkOrNumber", { n: i + 1 })} autoComplete="off" />
          <input dir="auto" value={b.label} maxLength={40} placeholder={t("company.labelOptional")} onChange={(e) => set(i, { label: e.target.value })} aria-label={t("company.labelOfButton", { n: i + 1 })} />
          <button type="button" className="btn ghost sm" onClick={() => onChange(items.filter((_, n) => n !== i))} aria-label={t("company.removeButton", { n: i + 1 })}><Icon name="x2" size="s" /></button>
        </div>
      ))}
      <div>
        <button type="button" className="btn ghost sm" disabled={items.length >= MAX_LIST} onClick={() => onChange([...items, { kind: "Website", value: "", label: "" }])}>
          <Icon name="plus" size="s" />{addLabel}
        </button>
      </div>
    </div>
  );
}
