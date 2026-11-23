"use client";

// The company's design requests: the one in progress, the ones that are finished, and the form for a new one.
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RequestForm } from "@/components/designs/RequestForm";
import { FaceStage, StatusPill, STAGE_PEOPLE } from "@/components/designs/shared";
import { Empty, ErrorBox, PageHead, SkeletonBlocks } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { designsApi } from "@/lib/designs/api";
import { useI18n } from "@/lib/i18n/client";

export default function RequestsPage() {
  const { current, isManager } = useWs();
  const { t, date } = useI18n();
  const [form, setForm] = useState(false);
  const list = useQuery({ queryKey: ["design-requests", current.id], queryFn: () => designsApi.requests(current.id), enabled: isManager && current.kind === "company" });
  const faces = useQuery({ queryKey: ["custom-faces", current.id], queryFn: () => designsApi.faces(current.id), enabled: current.kind === "company" });
  if (current.kind !== "company" || !isManager) return <div className="view"><Empty title={t("designs.companyOnly")}>{t("designs.companyOnlyText")}</Empty></div>;
  if (list.isLoading) return <div className="view"><SkeletonBlocks rows={3} /></div>;
  if (list.error) return <div className="view"><ErrorBox error={list.error} onRetry={() => void list.refetch()} /></div>;
  const rows = list.data ?? [];
  const open = rows.find((r) => !["live", "closed", "withdrawn"].includes(r.status));
  return (
    <div className="view">
      <PageHead title={t("designs.title")} sub={t("designs.sub")}>
        {!open && !form && <button className="btn" onClick={() => setForm(true)}>{t("designs.newRequest")}</button>}
      </PageHead>
      {form && !open && (
        <section className="panel" style={{ padding: 18 }}>
          <h2>{t("designs.newRequest")}</h2>
          <RequestForm wsId={current.id} />
        </section>
      )}
      {rows.length === 0 && !form && <Empty title={t("designs.emptyTitle")} action={<button className="btn" onClick={() => setForm(true)}>{t("designs.newRequest")}</button>}>{t("designs.emptyText")}</Empty>}
      {open && <div className="notice"><div className="grow">{t("designs.oneAtATime")}</div></div>}
      <div className="pane">
        {rows.map((r) => (
          <Link key={r.id} href={`/app/requests/${r.id}`} className="panel" style={{ padding: 14, display: "grid", gap: 6, textDecoration: "none" }}>
            <div className="row">
              <StatusPill status={r.status} />
              {r.unread > 0 && <span className="pill bad">{t("designs.unread", { n: r.unread })}</span>}
              <span className="grow" />
              <span className="hint">{date(r.created_at)}</span>
            </div>
            <div>{r.goals}</div>
            {r.face && <span className="hint">{t("designs.faceName", { name: r.face.name })}</span>}
          </Link>
        ))}
      </div>
      {(faces.data ?? []).length > 0 && (
        <section className="pane">
          <h2>{t("designs.yourDesigns")}</h2>
          <div className="g3">
            {faces.data!.map((f) => (
              <div key={f.id} className="panel" style={{ padding: 12, display: "grid", gap: 8 }}>
                <FaceStage face={f} colour={0} person={STAGE_PEOPLE[0]} companyName={current.name} thumb />
                <div className="row"><b>{f.name}</b><span className="grow" /><span className="pill ok">{t("designs.status.live")}</span></div>
                {!open && <Link className="btn ghost sm" href={`/app/requests/follow?face=${f.id}`}>{t("designs.changesToThis")}</Link>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
