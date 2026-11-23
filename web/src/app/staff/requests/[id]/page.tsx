"use client";

// One request for staff: the brief, the company, the files, the thread (with internal notes), status and assignee,
// and the faces made for it.
import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusPill, STATUS_KEYS, Thread } from "@/components/designs/shared";
import { ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import { errorText, staffApi, type Starter } from "@/lib/designs/api";
import { useI18n } from "@/lib/i18n/client";

export default function StaffRequest({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, date } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const q = useQuery({ queryKey: ["staff-request", id], queryFn: () => staffApi.request(id), refetchInterval: 30000 });
  const starters = useQuery({ queryKey: ["staff-starters"], queryFn: staffApi.starters });
  const board = useQuery({ queryKey: ["staff-board", "", "", ""], queryFn: () => staffApi.board({}), staleTime: 60000 });
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  if (q.isLoading) return <SkeletonBlocks rows={3} />;
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const put = (d: typeof r) => { qc.setQueryData(["staff-request", id], d); void qc.invalidateQueries({ queryKey: ["staff-board"] }); };
  const run = async (fn: () => Promise<void>) => { setErr(""); try { await fn(); } catch (e) { setErr(errorText(e, t)); } };

  return (
    <div className="view">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Link href="/staff/design-requests" className="btn ghost sm">{t("staff.back")}</Link>
        <h1>{r.company.name}</h1>
        <StatusPill status={r.status} />
      </div>
      {err && <div className="notice bad" role="alert"><div className="grow">{err}</div></div>}
      <div className="g2">
        <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}>
          <h2>{t("designs.brief")}</h2>
          <div style={{ whiteSpace: "pre-wrap" }}>{r.goals}</div>
          {r.brand_assets_notes && <div className="hint">{r.brand_assets_notes}</div>}
          {r.style_examples.map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" className="hint">{u}</a>)}
          <div className="hint">{t("staff.languages")}: {r.languages} · {t("staff.deadline")}: {r.deadline ?? "-"} · {t("staff.people")}: {r.employees_count ?? "-"}</div>
          <div className="hint">{t("staff.requestedBy")}: {r.requested_by} · {date(r.created_at)}</div>
          {r.notes && <div className="hint">{r.notes}</div>}
          <div className="hint">{r.allow_team_names ? t("staff.teamNamesYes") : t("staff.teamNamesNo")}</div>
        </section>
        <section className="panel" style={{ padding: 14, display: "grid", gap: 8, alignContent: "start" }}>
          <h2>{t("staff.company")}</h2>
          <div>{r.company_detail.name} · {r.company_detail.plan ?? t("staff.noPlan")} · {t("staff.seats", { used: r.company_detail.seats_used, total: r.company_detail.seats_total })}</div>
          <div className="hint">{r.company_detail.owner_email}</div>
          <label className="fg">
            <b>{t("staff.status")}</b>
            <div className="row">
              <select value="" onChange={(e) => e.target.value && void run(async () => { put(await staffApi.setStatus(id, e.target.value, note)); setNote(""); toast(t("staff.saved")); })} aria-label={t("staff.status")}>
                <option value="">{t("staff.moveTo")}</option>
                {r.moves.map((s) => <option key={s} value={s}>{t(STATUS_KEYS[s])}</option>)}
              </select>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("staff.statusNote")} aria-label={t("staff.statusNote")} />
            </div>
          </label>
          <label className="fg">
            <b>{t("staff.assignee")}</b>
            <select value={r.assigned?.id ?? ""} onChange={(e) => void run(async () => put(await staffApi.assign(id, e.target.value || null)))}>
              <option value="">{t("staff.unassigned")}</option>
              {(board.data?.staff ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </select>
          </label>
        </section>
      </div>

      <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}>
        <h2>{t("staff.faces")}</h2>
        {r.faces.map((f) => (
          <div key={f.id} className="row"><Link href={`/staff/faces/${f.id}`} className="btn ghost sm">{f.name}</Link><span className="pill">{f.status}</span><span className="hint">v{f.version}</span></div>
        ))}
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className="btn sm" onClick={() => void run(async () => { const f = await staffApi.createFace(id, null); router.push(`/staff/faces/${f.id}`); })}>{t("staff.createFace")}</button>
          {(starters.data ?? []).map((s: Starter) => (
            <button key={s.key} className="btn ghost sm" onClick={() => void run(async () => { const f = await staffApi.createFace(id, s.key); router.push(`/staff/faces/${f.id}`); })}>{t("staff.fromStarter", { name: s.name })}</button>
          ))}
        </div>
      </section>

      <Thread
        staff
        messages={r.messages}
        files={r.files}
        fileHref={(f) => staffApi.fileUrl(id, f)}
        upload={(f) => staffApi.upload(id, f)}
        send={async (body, ids, internal) => { await staffApi.message(id, body, internal, ids); put(await staffApi.request(id)); }}
      />
    </div>
  );
}
