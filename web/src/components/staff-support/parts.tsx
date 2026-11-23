"use client";

// Pieces shared by the staff support screens (English only).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MessageText } from "@/components/support/shared";
import { activeDeadline, SLA_TONE, timeToDue } from "@/lib/support/format";
import { ST } from "@/lib/support/staff-text";
import type { SlaState, StaffTicketRow, SupportMessage, TicketStatus } from "@/lib/support/types";
import s from "@/components/support/support.module.css";

const TABS = [
  { href: "/staff/support", label: ST.navInbox },
  { href: "/staff/support/chats", label: ST.navChat },
  { href: "/staff/support/metrics", label: ST.navMetrics },
  { href: "/staff/support/settings", label: ST.navSettings },
];

export function SupportTabs() {
  const pathname = usePathname();
  return (
    <nav className="row" aria-label={ST.inbox} style={{ flexWrap: "wrap", gap: 6 }}>
      {TABS.map((tab) => {
        const on = tab.href === "/staff/support" ? pathname === tab.href : pathname.startsWith(tab.href);
        return <Link key={tab.href} href={tab.href} aria-current={on ? "page" : undefined} className={`btn sm ${on ? "" : "ghost"}`}>{tab.label}</Link>;
      })}
    </nav>
  );
}

const STATUS_CLASS: Record<TicketStatus, string> = { new: "pill accent", open: "pill", waiting_customer: "pill warn", solved: "pill ok", closed: "pill" };
export function StatusPill({ status }: { status: TicketStatus }) {
  return <span className={STATUS_CLASS[status]}>{ST.statuses[status]}</span>;
}

const PRIORITY_CLASS: Record<string, string> = { low: "pill", normal: "pill", high: "pill warn", urgent: "pill bad" };
export function PriorityPill({ priority }: { priority: keyof typeof ST.priorities }) {
  return <span className={PRIORITY_CLASS[priority]}>{ST.priorities[priority]}</span>;
}

/** The clock now, refreshed every 30 seconds, so timers on screen move without a reload. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** The deadline timer of a request with its colour: green on track, amber at risk, red past the deadline. */
export function SlaChip({ ticket, now }: { ticket: Pick<StaffTicketRow, "sla" | "first_response_at" | "first_due_at" | "resolve_due_at">; now: number }) {
  const state: SlaState = ticket.sla;
  const left = state === "paused" || state === "done" ? null : timeToDue(activeDeadline(ticket), now);
  const tone = SLA_TONE[state];
  return (
    <span className={tone === "plain" ? "pill" : `pill ${tone}`} title={ST.sla_states[state]}>
      {left ? (left.late ? ST.over(left.text) : ST.left(left.text)) : ST.sla_states[state]}
    </span>
  );
}

/** The conversation as staff see it: internal notes are marked, the customer's side is on the other side. */
export function StaffConversation({ messages, fileHref, onOpenFile, dateTime }: {
  messages: SupportMessage[]; fileHref: (id: string) => string; onOpenFile: (path: string) => void; dateTime: (d: string) => string;
}) {
  return (
    <div className={s.thread} role="log">
      {messages.map((m) => {
        if (m.kind === "status") {
          return <div key={m.id} className={`${s.msg} ${s.system}`}>{m.status_to === "merged" ? `Merged request ${m.body}` : `Status: ${ST.statuses[m.status_to as TicketStatus] ?? m.status_to}`} · {dateTime(m.created_at)}</div>;
        }
        const klass = m.kind === "transcript" ? s.system : m.internal ? s.note : m.author === "staff" ? s.mine : s.theirs;
        return (
          <article key={m.id} className={`${s.msg} ${klass}`}>
            <div className={s.meta}>
              <b>{m.kind === "transcript" ? "Chat transcript" : m.author_name || ST.author[m.author]}</b>
              <span>{dateTime(m.created_at)}</span>
              {m.internal && <span className="pill warn">{ST.noteToggle}</span>}
              {m.via !== "web" && <span>{m.via === "email" ? "e-mail" : "chat"}</span>}
            </div>
            <MessageText text={m.body} />
            {m.files.length > 0 && (
              <div className={s.files}>
                {m.files.map((f) => <button key={f.id} type="button" className={s.file} onClick={() => onOpenFile(fileHref(f.id))}>{f.name}</button>)}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
