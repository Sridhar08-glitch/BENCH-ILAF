"use client";

// Small pieces the customer support screens share: status chip, message text with safe links, the conversation, files, context box.
import { useRef } from "react";
import { Icon } from "@/components/Icon";
import { tk, type MessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { contextLines } from "@/lib/support/context";
import { linkify } from "@/lib/support/linkify";
import type { Category, SupportContext, SupportFile, SupportMessage, TicketStatus } from "@/lib/support/types";
import { FILE_ACCEPT, MAX_FILES, checkFiles, type FileErrorKey } from "@/lib/support/validation";
import s from "./support.module.css";

export const STATUS_KEYS: Record<TicketStatus, MessageKey> = {
  new: tk("support.status.new"),
  open: tk("support.status.open"),
  waiting_customer: tk("support.status.waiting_customer"),
  solved: tk("support.status.solved"),
  closed: tk("support.status.closed"),
};

export const CATEGORY_KEYS: Record<Category, MessageKey> = {
  account: tk("support.cat.account"),
  billing: tk("support.cat.billing"),
  cards_design: tk("support.cat.cards_design"),
  team_company: tk("support.cat.team_company"),
  bug: tk("support.cat.bug"),
  feature_request: tk("support.cat.feature_request"),
  privacy_data: tk("support.cat.privacy_data"),
  other: tk("support.cat.other"),
};

const CTX_KEYS = {
  page: tk("support.ctx.page"),
  language: tk("support.ctx.language"),
  build: tk("support.ctx.build"),
  screen: tk("support.ctx.screen"),
  workspace: tk("support.ctx.workspace"),
  card: tk("support.ctx.card"),
  browser: tk("support.ctx.browser"),
  role: tk("support.ctx.role"),
  plan: tk("support.ctx.plan"),
} as const;

const CHIP_CLASS: Record<TicketStatus, string> = { new: "pill", open: "pill accent", waiting_customer: "pill warn", solved: "pill ok", closed: "pill" };

export function StatusChip({ status }: { status: TicketStatus }) {
  const { t } = useI18n();
  return <span className={CHIP_CLASS[status]}>{t(STATUS_KEYS[status])}</span>;
}

/** A message as text: addresses become links (http and https only), nothing is ever treated as HTML. */
export function MessageText({ text }: { text: string }) {
  return (
    <div className={s.body} dir="auto">
      {linkify(text).map((p, i) =>
        p.type === "link" ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow">{p.value}</a>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </div>
  );
}

export function FileLinks({ files, href }: { files: SupportFile[]; href: (id: string) => string }) {
  if (files.length === 0) return null;
  return (
    <div className={s.files}>
      {files.map((f) => (
        <a key={f.id} className={s.file} href={href(f.id)} target="_blank" rel="noopener noreferrer">
          <Icon name="upload" size="s" />{f.name}
        </a>
      ))}
    </div>
  );
}

/** The conversation of one request, oldest first. `mine` is the side the reader is on. */
export function Conversation({ messages, href }: { messages: SupportMessage[]; href: (id: string) => string }) {
  const { t, dateTime } = useI18n();
  return (
    <div className={s.thread} role="log" aria-live="polite">
      {messages.map((m) => {
        if (m.kind === "status") {
          const text = m.status_to === "merged" ? t("support.mergedLine") : t("support.statusLine", { status: STATUS_KEYS[m.status_to as TicketStatus] ? t(STATUS_KEYS[m.status_to as TicketStatus]) : m.status_to });
          return <div key={m.id} className={`${s.msg} ${s.system}`}>{text} · {dateTime(m.created_at)}</div>;
        }
        const mine = m.author === "customer";
        const who = m.kind === "transcript" ? t("support.transcript") : mine ? t("support.you") : m.author === "staff" ? m.author_name || t("support.team") : t("support.system");
        return (
          <article key={m.id} className={`${s.msg} ${m.kind === "transcript" ? s.system : mine ? s.mine : s.theirs}`}>
            <div className={s.meta}>
              <b>{who}</b>
              <span>{dateTime(m.created_at)}</span>
              {m.via === "email" && <span>{t("support.viaEmail")}</span>}
              {m.via === "chat" && m.kind !== "transcript" && <span>{t("support.viaChat")}</span>}
            </div>
            <MessageText text={m.body} />
            <FileLinks files={m.files} href={href} />
          </article>
        );
      })}
    </div>
  );
}

/** Pick files to attach: shows them as chips, refuses more than the limits allow. */
export function FilePicker({ files, onChange, onError, label, hint }: { files: File[]; onChange: (f: File[]) => void; onError: (key: FileErrorKey | null) => void; label: string; hint?: string }) {
  const { t } = useI18n();
  const pick = useRef<HTMLInputElement>(null);
  return (
    <div className="fg">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" className="btn ghost sm" onClick={() => pick.current?.click()} disabled={files.length >= MAX_FILES}>
          <Icon name="upload" size="s" /> {label}
        </button>
        <input
          ref={pick}
          type="file"
          multiple
          hidden
          accept={FILE_ACCEPT}
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            e.target.value = "";
            const problem = checkFiles(chosen, files.length);
            onError(problem);
            if (!problem) onChange([...files, ...chosen]);
          }}
        />
        {files.map((f, i) => (
          <span key={`${f.name}-${i}`} className="pill">
            {f.name}
            <button type="button" className="linkbtn" aria-label={t("support.removeFile", { name: f.name })} onClick={() => onChange(files.filter((_, k) => k !== i))}>x</button>
          </span>
        ))}
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/** Everything attached automatically, shown as it is sent, with the switch to leave it out. */
export function ContextBox({ ctx, on, onToggle }: { ctx: SupportContext; on: boolean; /** Without it the box only shows what was sent. */ onToggle?: (v: boolean) => void }) {
  const { t } = useI18n();
  const lines = contextLines(ctx);
  return (
    <section className="fg" aria-label={t("support.ctxTitle")}>
      <b>{t("support.ctxTitle")}</b>
      {onToggle && (
        <label className="chkrow">
          <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
          <span>{t("support.ctxToggle")}</span>
        </label>
      )}
      {on ? (
        <>
          <dl className={s.ctx}>
            {lines.map((l) => (
              <div key={l.key} className={s.ctxrow}>
                <dt>{t(CTX_KEYS[l.key])}</dt>
                <dd dir="ltr">{l.value}</dd>
              </div>
            ))}
          </dl>
          {onToggle && <span className="hint">{t("support.ctxServer")}</span>}
        </>
      ) : (
        <span className="hint">{t("support.ctxOff")}</span>
      )}
    </section>
  );
}
