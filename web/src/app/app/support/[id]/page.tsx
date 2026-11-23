"use client";

// One request: its conversation, a reply box with files, Mark as solved, Reopen and the rating once it is solved.
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorBox, PageHead, SkeletonBlocks } from "@/components/app/ui";
import { CATEGORY_KEYS, Conversation, ContextBox, FilePicker, StatusChip } from "@/components/support/shared";
import { tk, type MessageKey } from "@/lib/i18n";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { supportApi } from "@/lib/support/api";
import { OPEN_CHAT_EVENT } from "@/lib/support/events";
import type { TicketDetail } from "@/lib/support/types";
import type { FileErrorKey } from "@/lib/support/validation";
import s from "@/components/support/support.module.css";

const FILE_ERR: Record<FileErrorKey, MessageKey> = {
  tooManyFiles: tk("support.err.tooManyFiles"), fileTooBig: tk("support.err.fileTooBig"), fileType: tk("support.err.fileType"),
};

export default function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, date } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["support-ticket", id], queryFn: () => supportApi.ticket(id), refetchInterval: 20_000 });
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (q.data && q.data.unread > 0) void supportApi.seen(id).then(() => { void qc.invalidateQueries({ queryKey: ["support-summary"] }); void qc.invalidateQueries({ queryKey: ["support-tickets"] }); });
  }, [q.data, id, qc]);

  if (q.isLoading) return <div className="view"><SkeletonBlocks rows={3} /></div>;
  if (q.error || !q.data) return <div className="view"><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></div>;
  const r = q.data;
  const open = r.status === "new" || r.status === "open" || r.status === "waiting_customer";
  const done = async (fn: () => Promise<TicketDetail>) => {
    setProblem("");
    setBusy(true);
    try {
      qc.setQueryData(["support-ticket", id], await fn());
      await qc.invalidateQueries({ queryKey: ["support-tickets"] });
    } catch (e) {
      setProblem(apiErrorText(e, t, "support.err.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view">
      <PageHead title={r.subject} sub={`${t("support.requestNumber", { number: r.label })} · ${t("support.sentOn", { date: date(r.created_at) })}`}>
        <Link className="btn ghost sm" href="/app/support">{t("support.backToList")}</Link>
      </PageHead>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <StatusChip status={r.status} />
        <span className="hint">{t(CATEGORY_KEYS[r.category])}</span>
        <span className="grow" />
        {open && <button className="btn ghost sm" disabled={busy} onClick={() => void done(() => supportApi.solve(id))}>{t("support.markSolved")}</button>}
        {r.can_reopen && <button className="btn sm" disabled={busy} onClick={() => void done(() => supportApi.reopen(id))}>{t("support.reopen")}</button>}
      </div>
      {r.active_chat_id && (
        <div className="notice" role="status">
          <div className="grow">{t("support.chatActive")}</div>
          <button type="button" className="btn sm" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: { id: r.active_chat_id } }))}>{t("support.joinChat")}</button>
        </div>
      )}
      {problem && <div className="notice bad" role="alert"><div className="grow">{problem}</div></div>}
      <Conversation messages={r.messages} href={(f) => supportApi.fileUrl(id, f)} />

      {r.status === "solved" && <div className="notice" role="note"><div className="grow">{r.can_reopen && r.reopen_until ? t("support.solvedNote", { date: date(r.reopen_until) }) : t("support.solvedExpired")}</div></div>}
      {r.status === "closed" && <div className="notice" role="note"><div className="grow">{t("support.closedNote")}</div></div>}

      {(r.status === "solved" || r.status === "closed") && (
        <section className="panel" style={{ padding: 16, display: "grid", gap: 10 }}>
          {r.rating ? (
            <b>{t("support.rated")}</b>
          ) : (
            <>
              <h2>{t("support.rateTitle")}</h2>
              <span className="hint">{t("support.rateText")}</span>
              <div className={s.stars} role="group" aria-label={t("support.rateTitle")}>
                {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={s.star} aria-pressed={stars === n} aria-label={t("support.rateStar", { n })} onClick={() => setStars(n)}>{n}</button>)}
              </div>
              <label className="fg"><b>{t("support.rateComment")}</b><textarea rows={2} value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} /></label>
              <div><button className="btn" disabled={busy || stars === 0} onClick={() => void done(() => supportApi.rate(id, stars, comment))}>{t("support.rateSend")}</button></div>
            </>
          )}
        </section>
      )}

      {(open || r.can_reopen) && (
        <form className="pane" onSubmit={(e) => { e.preventDefault(); if (!body.trim() && files.length === 0) return; void done(async () => { const d = await supportApi.reply(id, body.trim(), files); setBody(""); setFiles([]); return d; }); }}>
          <label className="fg">
            <b>{t("support.reply")}</b>
            <textarea rows={4} value={body} maxLength={10000} placeholder={t("support.replyPh")} onChange={(e) => setBody(e.target.value)} />
          </label>
          <FilePicker files={files} onChange={setFiles} onError={(k) => setProblem(k ? t(FILE_ERR[k]) : "")} label={t("support.attach")} hint={t("support.fFilesHint")} />
          <div><button className="btn" disabled={busy || (!body.trim() && files.length === 0)}>{t("support.sendReply")}</button></div>
        </form>
      )}

      <details className="panel" style={{ padding: 12 }}>
        <summary>{t("support.ctxOpen")}</summary>
        <ContextBox ctx={r.context} on={Object.keys(r.context).length > 0} />
      </details>
    </div>
  );
}
