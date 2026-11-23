"use client";

// One profile field in the card editor, shown according to the company's rule for it:
// free (a normal field), locked (read only, with the reason) or needs approval (read only with a "Request change" flow).
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/lib/i18n/client";
import { FREE_ACCESS, fieldHint, fieldWordIn, pendingFor } from "@/lib/ops/fields";
import type { EditorApi } from "@/components/editor/types";
import s from "./ops.module.css";

type Field = "name" | "title" | "company" | "address";

export function GuardedField({ ed, field, label, multiline, autoComplete }: { ed: EditorApi; field: Field; label: string; multiline?: boolean; autoComplete?: string }) {
  const { t } = useI18n();
  const access = ed.access ?? FREE_ACCESS;
  const perm = access[field];
  const value = ed.draft[field];
  const waiting = !!pendingFor(ed.pending, field);
  const [asking, setAsking] = useState(false);
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (perm === "free") {
    return (
      <label>
        {label}
        {multiline ? (
          <textarea dir="auto" value={value} onChange={(e) => ed.update({ [field]: e.target.value })} />
        ) : (
          <input dir="auto" value={value} onChange={(e) => ed.update({ [field]: e.target.value })} autoComplete={autoComplete} />
        )}
      </label>
    );
  }

  const hint = fieldHint(field, perm, waiting, t);

  async function send() {
    if (!ed.requestChange) return;
    if (next.trim() === value.trim()) return setProblem(t("company.sameValue", { word: fieldWordIn(field, t) }));
    setBusy(true);
    const p = await ed.requestChange(field, next.trim());
    setBusy(false);
    setProblem(p);
    if (!p) setAsking(false);
  }

  return (
    <div className="pane" style={{ gap: 6 }}>
      <label>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name={perm === "locked" ? "lock" : "clock"} size="s" />{label}
        </span>
        {multiline ? (
          <textarea dir="auto" value={value} readOnly disabled className={s.lockedInput} />
        ) : (
          <input dir="auto" value={value} readOnly disabled className={s.lockedInput} autoComplete={autoComplete} />
        )}
      </label>
      {hint && <div className={`${s.fieldHint} ${waiting ? s.wait : s.lock}`} role="status">{hint}</div>}
      {perm === "approval" && !waiting && !asking && ed.requestChange && (
        <div>
          <button type="button" className="btn ghost sm" onClick={() => { setNext(value); setProblem(null); setAsking(true); }}>{t("company.requestChange")}</button>
        </div>
      )}
      {perm === "approval" && asking && (
        <div className="pane" style={{ gap: 8 }}>
          <label>
            {t("company.newValueFor", { word: fieldWordIn(field, t) })}
            {multiline ? (
              <textarea dir="auto" value={next} onChange={(e) => setNext(e.target.value)} autoFocus />
            ) : (
              <input dir="auto" value={next} onChange={(e) => setNext(e.target.value)} autoComplete={autoComplete} autoFocus />
            )}
          </label>
          {problem && <span className="err" role="alert">{problem}</span>}
          <div className="row">
            <button type="button" className="btn sm" disabled={busy || !next.trim()} onClick={() => void send()}>{busy ? t("company.sending") : t("company.sendToAdmin")}</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setAsking(false)}>{t("common.cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
