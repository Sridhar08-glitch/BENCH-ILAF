"use client";

// The before / after view of one change request: text with changed words marked, two pictures, or a list of buttons.
import { useI18n } from "@/lib/i18n/client";
import { buttonText, diffButtons, fieldWordIn, textDiff } from "@/lib/ops/fields";
import type { ChangeRequest } from "@/lib/types";
import s from "./ops.module.css";

const urlOf = (v: unknown): string | null => (v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string" ? (v as { url: string }).url : null);

export function ChangeView({ change }: { change: Pick<ChangeRequest, "field" | "old" | "new"> }) {
  const { t } = useI18n();
  if (change.field === "photo") {
    const oldUrl = urlOf(change.old);
    const newUrl = urlOf(change.new);
    return (
      <div className={s.diff}>
        <div className={s.diffBox}><small>{t("company.now")}</small>{oldUrl ? <img className={s.pic} src={oldUrl} alt={t("company.currentPhoto")} /> : <span className="hint">{t("company.noPhoto")}</span>}</div>
        <div className={`${s.diffBox} ${s.new}`}><small>{t("company.requested")}</small>{newUrl ? <img className={s.pic} src={newUrl} alt={t("company.requestedPhoto")} /> : <span className="hint">{t("company.noPhoto")}</span>}</div>
      </div>
    );
  }
  if (change.field === "buttons") {
    const d = diffButtons(change.old, change.new);
    return (
      <div className={s.diff}>
        <div className={s.diffBox}>
          <small>{t("company.removed")}</small>
          {d.removed.length === 0 ? <span className="hint">{t("company.nothingRemoved")}</span> : <ul className={s.btnlist}>{d.removed.map((b, i) => <li key={i} className={s.del} dir="auto">{buttonText(b)}</li>)}</ul>}
        </div>
        <div className={`${s.diffBox} ${s.new}`}>
          <small>{t("company.added")}</small>
          {d.added.length === 0 ? <span className="hint">{t("company.nothingAdded")}</span> : <ul className={s.btnlist}>{d.added.map((b, i) => <li key={i} className={s.add} dir="auto">{buttonText(b)}</li>)}</ul>}
        </div>
      </div>
    );
  }
  const oldText = typeof change.old === "string" ? change.old : "";
  const newText = typeof change.new === "string" ? change.new : "";
  const parts = textDiff(oldText, newText);
  return (
    <div className={s.diff}>
      <div className={s.diffBox}>
        <small>{t("company.nowField", { field: fieldWordIn(change.field, t) })}</small>
        <div dir="auto">{oldText ? parts.filter((p) => p.kind !== "add").map((p, i) => <span key={i} className={p.kind === "del" ? s.del : undefined}>{p.text}</span>) : <span className="hint">{t("company.empty")}</span>}</div>
      </div>
      <div className={`${s.diffBox} ${s.new}`}>
        <small>{t("company.requested")}</small>
        <div dir="auto">{newText ? parts.filter((p) => p.kind !== "del").map((p, i) => <span key={i} className={p.kind === "add" ? s.add : undefined}>{p.text}</span>) : <span className="hint">{t("company.empty")}</span>}</div>
      </div>
    </div>
  );
}
