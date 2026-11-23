"use client";

// Building blocks of the staff dashboard (English text, BENCH look): page head, tabs, pills, pager, reason dialogs, role gates.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog } from "@/components/ops/shared";
import { ErrorBox, SkeletonBlocks } from "@/components/app/ui";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { staffApi } from "@/lib/designs/api";
import { can, whyNot, type Permission, type StaffRole } from "@/lib/staff-admin/roles";

/** The signed-in staff person's role (the shell already loaded it). */
export function useRole(): StaffRole | undefined {
  const me = useQuery({ queryKey: ["staff-me"], queryFn: staffApi.me, retry: false, staleTime: 60_000 });
  return me.data?.staff_role;
}

export function useCan(permission: Permission): boolean {
  return can(useRole(), permission);
}

/** A readable sentence for a failed call. */
export function useFail(): (error: unknown) => string {
  const { t } = useI18n();
  return (error) => apiErrorText(error, t);
}

export function Page({ title, sub, actions, children }: { title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="view">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {sub && <p className="sub">{sub}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly { key: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="row" style={{ gap: 4, borderBottom: "1px solid var(--line)", paddingBottom: 0, overflowX: "auto", flexWrap: "nowrap" }}>
      {tabs.map((tab) => (
        <button
          key={tab.key} type="button" role="tab" aria-selected={tab.key === value} onClick={() => onChange(tab.key)}
          style={{ background: "none", border: 0, borderBottom: tab.key === value ? "3px solid var(--orange)" : "3px solid transparent", padding: "10px 12px", fontWeight: tab.key === value ? 700 : 500, cursor: "pointer", color: "var(--ink)", whiteSpace: "nowrap" }}
        >
          {tab.label}{tab.count != null && <span className="pill" style={{ marginInlineStart: 6 }}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ items, value, onChange }: { items: readonly { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="row" role="group">
      {items.map((c) => <button key={c.key} type="button" className={`btn sm ${c.key === value ? "" : "ghost"}`} aria-pressed={c.key === value} onClick={() => onChange(c.key)}>{c.label}</button>)}
    </div>
  );
}

export type Tone = "ok" | "warn" | "bad" | "accent" | "dark" | "";
export function Pill({ tone = "", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

/** Tone for the usual words. */
export function toneOf(word: string): Tone {
  if (["ok", "active", "live", "sent", "won", "done", "actioned", "completed", "resent", "published", "everyone", "up"].includes(word)) return "ok";
  if (["late", "warn", "warning", "pending", "reviewing", "contacted", "qualified", "selected", "scheduled", "expired", "no_plan", "draft", "overdue", "soon", "processing"].includes(word)) return "warn";
  if (["failed", "bad", "suspended", "critical", "lost", "off", "deletion_pending", "dismissed_bad", "new_late"].includes(word)) return "bad";
  return "";
}

export function Pager({ page, pages, count, onPage }: { page: number; pages: number; count: number; onPage: (p: number) => void }) {
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <span className="hint">{count} in total</span>
      <span className="row">
        <button type="button" className="btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="hint">Page {page} of {pages}</span>
        <button type="button" className="btn ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </span>
    </div>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: Tone }) {
  return (
    <div className="panel" style={{ padding: 14, display: "grid", gap: 2 }}>
      <span className="hint">{label}</span>
      <b style={{ fontSize: 26, lineHeight: 1.1, color: tone === "bad" ? "var(--danger)" : undefined }}>{value}</b>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Loading() {
  return <SkeletonBlocks rows={3} />;
}

/** Waits for a query: a skeleton, an error box with Retry, or the data. */
export function Await<T>({ q, children }: { q: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown }; children: (data: T) => React.ReactNode }) {
  if (q.isLoading) return <Loading />;
  if (q.error || q.data === undefined) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  return <>{children(q.data)}</>;
}

/** A button for an action only some roles may take: the others see it greyed out with the reason. */
export function RoleButton({ perm, className = "btn", children, onClick, disabled, title }: { perm: Permission; className?: string; children: React.ReactNode; onClick?: () => void; disabled?: boolean; title?: string }) {
  const role = useRole();
  const allowed = can(role, perm);
  return (
    <button type="button" className={className} disabled={disabled || !allowed} aria-disabled={disabled || !allowed} title={allowed ? title : whyNot(role, perm)} onClick={allowed ? onClick : undefined}>
      {children}
    </button>
  );
}

/** Shows its children only to roles that have the permission. */
export function OnlyFor({ perm, children }: { perm: Permission; children: React.ReactNode }) {
  return useCan(perm) ? <>{children}</> : null;
}

/** A dialog that asks for a written reason (and, when `typed` is given, that exact text) before a risky action. */
export function ReasonDialog({
  title, text, confirm, danger, minLength = 5, typed, extraCheck, onClose, onConfirm,
}: {
  title: string; text?: React.ReactNode; confirm: string; danger?: boolean; minLength?: number; typed?: string; extraCheck?: string;
  onClose: () => void; onConfirm: (reason: string, extra: boolean) => Promise<unknown>;
}) {
  const fail = useFail();
  const [reason, setReason] = useState("");
  const [typedText, setTypedText] = useState("");
  const [extra, setExtra] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ready = reason.trim().length >= minLength && (!typed || typedText.trim().toLowerCase() === typed.trim().toLowerCase()) && (!extraCheck || extra);
  async function go() {
    setBusy(true);
    setErr("");
    try { await onConfirm(reason.trim(), extra); onClose(); } catch (e) { setErr(fail(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog
      title={title} onClose={onClose}
      footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className={`btn ${danger ? "danger" : ""}`} disabled={!ready || busy} onClick={() => void go()}>{busy ? "Working..." : confirm}</button></>}
    >
      <div style={{ display: "grid", gap: 10 }}>
        {text && <div>{text}</div>}
        <label style={{ display: "grid", gap: 4 }}>Reason (kept in the audit log)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} placeholder={`At least ${minLength} characters`} />
        </label>
        {typed && (
          <label style={{ display: "grid", gap: 4 }}>Type <b>{typed}</b> to confirm
            <input value={typedText} onChange={(e) => setTypedText(e.target.value)} autoComplete="off" />
          </label>
        )}
        {extraCheck && <label className="row"><input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} /> {extraCheck}</label>}
        {err && <span className="err" role="alert">{err}</span>}
      </div>
    </Dialog>
  );
}

/** Debounced value, for search boxes. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{head.map((h, i) => <th key={`${h}${i}`} style={{ textAlign: "start", padding: 10, fontSize: 12, color: "var(--mute)", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const td: React.CSSProperties = { padding: 10, borderTop: "1px solid var(--line)", verticalAlign: "top" };

export function NoRows({ children }: { children: React.ReactNode }) {
  return <div className="panel" style={{ padding: 24, textAlign: "center" }}><span className="sub">{children}</span></div>;
}

/** A note that reminds that this screen is sample-free and live. */
export function Parked({ children }: { children: React.ReactNode }) {
  return <div className="notice warn" role="note"><div className="grow">{children}</div></div>;
}
