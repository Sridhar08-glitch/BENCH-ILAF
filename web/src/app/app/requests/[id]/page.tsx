"use client";

// One request: where it is, the conversation, and, when a design is ready, Preview, Approve and Request changes.
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaceStage, STAGE_PEOPLE, StatusPill, Thread, Timeline } from "@/components/designs/shared";
import { ErrorBox, PageHead, SkeletonBlocks, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { designsApi, errorText } from "@/lib/designs/api";
import { useI18n } from "@/lib/i18n/client";

export default function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { current } = useWs();
  const { t, date } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const ws = current.id;
  const q = useQuery({ queryKey: ["design-request", ws, id], queryFn: () => designsApi.request(ws, id), refetchInterval: 30000 });
  const [showPreview, setShowPreview] = useState(false);
  const [changes, setChanges] = useState(false);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");
  const preview = useQuery({ queryKey: ["design-preview", ws, id], queryFn: () => designsApi.preview(ws, id), enabled: showPreview || !!q.data?.can_review });

  useEffect(() => {
    if (q.data && q.data.unread > 0) void designsApi.seen(ws, id).then(() => qc.invalidateQueries({ queryKey: ["design-requests-summary", ws] }));
  }, [q.data, ws, id, qc]);

  if (q.isLoading) return <div className="view"><SkeletonBlocks rows={3} /></div>;
  if (q.error || !q.data) return <div className="view"><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></div>;
  const r = q.data;
  const refresh = async (d: typeof r) => {
    qc.setQueryData(["design-request", ws, id], d);
    await qc.invalidateQueries({ queryKey: ["design-requests", ws] });
    await qc.invalidateQueries({ queryKey: ["custom-faces", ws] });
  };
  const act = async (fn: () => Promise<typeof r>, done: string) => {
    setErr("");
    try { await refresh(await fn()); toast(done); } catch (e) { setErr(errorText(e, t)); }
  };
  const brand = preview.data?.company.brand ?? null;

  return (
    <div className="view">
      <PageHead title={t("designs.requestTitle")} sub={t("designs.requestedOn", { date: date(r.created_at) })}>
        <Link className="btn ghost sm" href="/app/requests">{t("designs.allRequests")}</Link>
      </PageHead>
      <div className="row" style={{ flexWrap: "wrap" }}><StatusPill status={r.status} /></div>
      <Timeline status={r.status} />
      {err && <div className="notice bad" role="alert"><div className="grow">{err}</div></div>}

      {preview.data && (r.can_review || showPreview || r.status === "live") && (
        <section className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>
          <h2>{r.status === "live" ? t("designs.liveFace", { name: preview.data.face.name }) : t("designs.reviewTitle")}</h2>
          <div className="g2">
            {[0, 1, 2, 3].map((c) => (
              <FaceStage key={c} face={preview.data.face} colour={c} person={STAGE_PEOPLE[c % 2]} companyName={preview.data.company.name} brandJson={brand} />
            ))}
          </div>
          {r.can_review && !changes && (
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn" onClick={() => void act(() => designsApi.approve(ws, id), t("designs.approvedToast"))}>{t("designs.approve")}</button>
              <button className="btn ghost" onClick={() => setChanges(true)}>{t("designs.requestChanges")}</button>
            </div>
          )}
          {changes && (
            <div className="pane">
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("designs.changesPlaceholder")} aria-label={t("designs.changesPlaceholder")} />
              <div className="row">
                <button className="btn" disabled={!comment.trim()} onClick={() => void act(async () => { const d = await designsApi.requestChanges(ws, id, comment); setChanges(false); setComment(""); return d; }, t("designs.changesSent"))}>{t("designs.sendChanges")}</button>
                <button className="btn ghost" onClick={() => setChanges(false)}>{t("common.cancel")}</button>
              </div>
            </div>
          )}
        </section>
      )}
      {r.face && r.status === "approved" && !showPreview && <div><button className="btn ghost sm" onClick={() => setShowPreview(true)}>{t("designs.preview")}</button></div>}

      <section className="panel" style={{ padding: 16, display: "grid", gap: 6 }}>
        <h2>{t("designs.brief")}</h2>
        <div style={{ whiteSpace: "pre-wrap" }}>{r.goals}</div>
        {r.brand_assets_notes && <div className="hint">{r.brand_assets_notes}</div>}
        {r.style_examples.map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" className="hint">{u}</a>)}
      </section>

      <Thread
        messages={r.messages}
        files={r.files}
        fileHref={(f) => designsApi.fileUrl(ws, id, f)}
        upload={(f) => designsApi.upload(ws, id, f)}
        disabled={r.status === "closed" || r.status === "withdrawn"}
        send={async (body, ids) => { await refresh(await designsApi.message(ws, id, body, ids)); }}
      />
      {r.can_withdraw && (
        <div><button className="btn danger sm" onClick={() => void act(() => designsApi.withdraw(ws, id), t("designs.withdrawnToast"))}>{t("designs.withdraw")}</button></div>
      )}
    </div>
  );
}
