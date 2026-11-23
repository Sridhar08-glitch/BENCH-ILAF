"use client";

// Small building blocks used by the company operations screens: checkbox, dialog, action bar, result list.
import { useEffect, useRef } from "react";
import { Icon } from "@/components/Icon";
import { groupReasons, summarize } from "@/lib/ops/bulk";
import { useI18n } from "@/lib/i18n/client";
import type { BulkResult } from "@/lib/types";
import s from "./ops.module.css";

/** The marker to pass where a styled node (a bold name, a link) goes inside a translated sentence. */
export const SLOT = "\u0001";

/** Puts `children` where the marker is in `text`, so one translated sentence can hold a bold name. */
export function WithSlot({ text, children }: { text: string; children: React.ReactNode }) {
  const [before = "", after = ""] = text.split(SLOT);
  return <>{before}{children}{after}</>;
}

/** The marker for the n-th styled piece of a sentence: pass `slot(0)`, `slot(1)` as values, then give the pieces to <Weave>. */
export const slot = (n: number) => `\u0001${n}\u0002`;

/** Puts several styled pieces (code, bold, links) inside one translated sentence at their markers. */
export function Weave({ text, nodes }: { text: string; nodes: React.ReactNode[] }) {
  const parts = text.split(/\u0001(\d+)\u0002/);
  return <>{parts.map((p, i) => (i % 2 === 1 ? <span key={i}>{nodes[Number(p)]}</span> : p))}</>;
}

/** A real checkbox drawn in the BENCH style. `indeterminate` shows the dash for a partly picked list. */
export function Check({ checked, onChange, label, indeterminate, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; indeterminate?: boolean; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <span className={s.chk}>
      <input ref={ref} type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true">{checked ? <Icon name="check" size="s" /> : indeterminate ? <span style={{ width: 10, height: 2, background: "#fff", borderRadius: 2 }} /> : null}</i>
    </span>
  );
}

/** A modal dialog. Escape and a click outside close it; the first field gets the focus. */
export function Dialog({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    const first = ref.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button.btn");
    first?.focus();
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="sheet fixed" style={{ justifyContent: "center", alignItems: "center", padding: 12 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dlg ${wide ? s.dlgWide : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h2 style={{ fontSize: 18 }}>{title}</h2>
          <button type="button" className="x" aria-label={t("common.close")} onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer" }}><Icon name="x2" size="s" /></button>
        </div>
        <div className={s.dlgBody}>{children}</div>
        {footer && <div className={s.dlgFoot}>{footer}</div>}
      </div>
    </div>
  );
}

/** The bar that appears over a list once something is selected. */
export function SelectionBar({ count, children, onClear }: { count: number; children: React.ReactNode; onClear: () => void }) {
  const { t } = useI18n();
  return (
    <div className={s.bar} role="region" aria-label={t("company.selectionAria")}>
      <b aria-live="polite">{t("company.selectedCount", { n: count })}</b>
      <span className="grow" style={{ flex: 1 }} />
      {children}
      <button type="button" className={s.link} onClick={onClear}>{t("company.clear")}</button>
    </div>
  );
}

/** What a bulk run did: the one-line summary and every refused item with its reason. */
export function ResultsDialog({ result, onClose }: { result: BulkResult; onClose: () => void }) {
  const { t, list } = useI18n();
  const groups = groupReasons(result, t);
  return (
    <Dialog title={t("common.done")} onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>{t("common.close")}</button>}>
      <div className={`notice ${result.failed ? "warn" : ""}`} role="status">
        <Icon name={result.failed ? "alert" : "check"} />
        <div className="grow"><b>{summarize(result, t)}</b>{result.failed > 0 ? t("company.resultsRefused") : t("company.resultsAllUpdated")}</div>
      </div>
      {groups.length > 0 && (
        <div className={s.results}>
          {groups.map((g) => (
            <div key={g.reason} className={`${s.resultRow} ${s.bad}`}>
              <Icon name="alert" size="s" />
              <div>
                <b>{g.reason}</b>
                <div className={s.names} dir="auto">
                  {g.names.length > 12
                    ? t("company.itemsListMore", { n: g.names.length, names: g.names.slice(0, 12).join(", "), more: g.names.length - 12 })
                    : t("company.itemsList", { n: g.names.length, names: list(g.names) })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
