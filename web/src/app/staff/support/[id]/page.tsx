"use client";

// One support request for staff: the conversation, reply and internal notes, saved replies, assignment and status,
// the customer panel, the satisfaction result, and starting a chat or merging duplicates.
import Link from "next/link";
import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import { PriorityPill, SlaChip, StaffConversation, StatusPill, SupportTabs, useNow } from "@/components/staff-support/parts";
import { staffApi } from "@/lib/designs/api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { staffSupportApi } from "@/lib/support/api";
import { contextLines } from "@/lib/support/context";
import { ST } from "@/lib/support/staff-text";
import { CATEGORIES, PRIORITIES, STATUSES, type StaffTicketDetail } from "@/lib/support/types";

export default function StaffTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const now = useNow();
  const me = useQuery({ queryKey: ["staff-me"], queryFn: staffApi.me });
  const role = me.data?.staff_role;
  const canWrite = role === "support" || role === "admin";
  const q = useQuery({ queryKey: ["staff-ticket", id], queryFn: () => staffSupportApi.ticket(id), refetchInterval: 20_000 });
  const canned = useQuery({ queryKey: ["staff-canned"], queryFn: staffSupportApi.canned });
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [mergeInto, setMergeInto] = useState("");
  const [banDays, setBanDays] = useState(7);
  const [banReason, setBanReason] = useState("");

  if (q.isLoading) return <div className="view"><SkeletonBlocks rows={3} /></div>;
  if (q.error || !q.data) return <div className="view"><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></div>;
  const r = q.data;
  const put = (d: StaffTicketDetail) => { qc.setQueryData(["staff-ticket", id], d); void qc.invalidateQueries({ queryKey: ["staff-inbox"] }); };
  const run = async (fn: () => Promise<StaffTicketDetail | unknown>, done: string = ST.saved) => {
    setProblem("");
    setBusy(true);
    try {
      const out = await fn();
      if (out && typeof out === "object" && "messages" in out) put(out as StaffTicketDetail);
      toast(done);
    } catch (e) {
      setProblem(apiErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  const patch = (b: Record<string, unknown>) => void run(() => staffSupportApi.update(id, b));
  const customer = r.customer;
  const ctx = contextLines(r.context);

  return (
    <div className="view">
      <SupportTabs />
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Link className="btn ghost sm" href="/staff/support">{ST.back}</Link>
        <h1 dir="auto" style={{ margin: 0 }}>{r.label} · {r.subject}</h1>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <StatusPill status={r.status} /><PriorityPill priority={r.priority} /><SlaChip ticket={r} now={now} />
        <span className="hint">{ST.categories[r.category]} · {ST.channels[r.channel]} · {r.language.toUpperCase()}</span>
        {r.merged_into && <span className="pill">{`Merged into ${r.merged_into}`}</span>}
        {r.spam && <span className="pill bad">Spam</span>}
      </div>
      {!canWrite && <div className="notice" role="note"><div className="grow">{ST.readOnly}</div></div>}
      {problem && <div className="notice bad" role="alert"><div className="grow">{problem}</div></div>}

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 340px)", alignItems: "start" }} className="stk">
        <div className="pane" style={{ minWidth: 0 }}>
          <h2>{ST.conversation}</h2>
          <StaffConversation
            messages={r.messages}
            fileHref={(f) => `staff/support/tickets/${id}/files/${f}/download`}
            onOpenFile={(p) => void staffSupportApi.openFile(p).catch((e) => setProblem(apiErrorText(e, t)))}
            dateTime={dateTime}
          />
          {canWrite && (
            <form
              className="panel pane"
              style={{ padding: 14, gap: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!body.trim() && files.length === 0) return;
                void run(async () => {
                  const out = await staffSupportApi.reply(id, { body: body.trim(), internal, status: internal || !after ? undefined : after }, files);
                  setBody(""); setFiles([]); setInternal(false); setAfter("");
                  return out;
                });
              }}
            >
              <label className="fg">
                <b>{internal ? ST.note : ST.reply}</b>
                <textarea rows={5} value={body} maxLength={10000} onChange={(e) => setBody(e.target.value)} dir="auto" />
              </label>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <label className="chkrow"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /><span>{ST.noteToggle}</span></label>
                <select aria-label={ST.canned} value="" onChange={(e) => { const c = canned.data?.find((x) => String(x.id) === e.target.value); if (c) setBody((b) => (b ? b + "\n" : "") + (r.language === "ar" && c.body_ar ? c.body_ar : c.body_en)); }}>
                  <option value="">{ST.canned}</option>
                  {(canned.data ?? []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                {!internal && (
                  <select aria-label={ST.setAfter} value={after} onChange={(e) => setAfter(e.target.value)}>
                    <option value="">{ST.keepStatus}</option>{STATUSES.map((s) => <option key={s} value={s}>{ST.statuses[s]}</option>)}
                  </select>
                )}
                <label className="btn ghost sm" style={{ cursor: "pointer" }}>
                  {ST.attach}
                  <input type="file" multiple hidden accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.log" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 5)); e.target.value = ""; }} />
                </label>
                {files.map((f, i) => <span key={i} className="pill">{f.name} <button type="button" className="linkbtn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, k) => k !== i))}>x</button></span>)}
                <span className="grow" />
                <button className="btn" disabled={busy || (!body.trim() && files.length === 0)}>{internal ? ST.saveNote : ST.sendReply}</button>
              </div>
            </form>
          )}
        </div>

        <aside className="pane" style={{ minWidth: 0 }}>
          <section className="panel pane" style={{ padding: 14 }}>
            <h2>{ST.details}</h2>
            <label className="fg"><b>{ST.assignee}</b>
              <select disabled={!canWrite || busy} value={r.assigned_to ?? ""} onChange={(e) => patch({ assigned_to: e.target.value || null })}>
                <option value="">{ST.unassigned}</option>{r.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="fg"><b>{ST.status}</b>
              <select disabled={!canWrite || busy} value={r.status} onChange={(e) => patch({ status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{ST.statuses[s]}</option>)}</select>
            </label>
            <label className="fg"><b>{ST.priority}</b>
              <select disabled={!canWrite || busy} value={r.priority} onChange={(e) => patch({ priority: e.target.value })}>{PRIORITIES.map((s) => <option key={s} value={s}>{ST.priorities[s]}</option>)}</select>
            </label>
            <label className="fg"><b>{ST.category}</b>
              <select disabled={!canWrite || busy} value={r.category} onChange={(e) => patch({ category: e.target.value })}>{CATEGORIES.map((s) => <option key={s} value={s}>{ST.categories[s]}</option>)}</select>
            </label>
            <dl style={{ margin: 0, display: "grid", gap: 4, fontSize: 13 }}>
              <div><dt className="hint">{ST.created}</dt><dd style={{ margin: 0 }}>{dateTime(r.created_at)}</dd></div>
              <div><dt className="hint">{ST.firstDue}</dt><dd style={{ margin: 0 }}>{r.first_due_at ? dateTime(r.first_due_at) : "-"}</dd></div>
              <div><dt className="hint">{ST.firstReply}</dt><dd style={{ margin: 0 }}>{r.first_response_at ? dateTime(r.first_response_at) : "-"}</dd></div>
              <div><dt className="hint">{ST.resolveDue}</dt><dd style={{ margin: 0 }}>{r.resolve_due_at ? dateTime(r.resolve_due_at) : "-"}</dd></div>
            </dl>
          </section>

          <section className="panel pane" style={{ padding: 14 }}>
            <h2>{ST.customer}</h2>
            <b dir="auto">{customer.full_name || customer.name || customer.email}</b>
            <span dir="ltr" className="hint">{customer.email}</span>
            {!customer.signed_in && <span className="hint">{ST.guest}</span>}
            {customer.signed_in && (
              <dl style={{ margin: 0, display: "grid", gap: 4, fontSize: 13 }}>
                <div><dt className="hint">{ST.verified}</dt><dd style={{ margin: 0 }}>{customer.email_verified ? "Yes" : "No"}</dd></div>
                <div><dt className="hint">{ST.accountCreated}</dt><dd style={{ margin: 0 }}>{customer.created_at ? dateTime(customer.created_at) : "-"}</dd></div>
                <div><dt className="hint">{ST.lastSignIn}</dt><dd style={{ margin: 0 }}>{customer.last_sign_in ? dateTime(customer.last_sign_in) : "-"}</dd></div>
              </dl>
            )}
            <span className="hint">{ST.requests}: {customer.ticket_count}</span>
            {customer.workspace && (
              <dl style={{ margin: 0, display: "grid", gap: 4, fontSize: 13 }}>
                <div><dt className="hint">{ST.workspace}</dt><dd style={{ margin: 0 }} dir="auto">{customer.workspace.name}</dd></div>
                <div><dt className="hint">{ST.plan}</dt><dd style={{ margin: 0 }}>{customer.workspace.plan || "-"} ({customer.workspace.plan_status})</dd></div>
              </dl>
            )}
            <div><b className="hint">{ST.recentErrors}</b><div>{customer.recent_errors.length ? customer.recent_errors.join(", ") : <span className="hint">{ST.none}</span>}</div></div>
            <span title={customer.support_view.available ? undefined : ST.supportViewWhy}>
              <button type="button" className="btn ghost sm" disabled aria-disabled="true" aria-label={`${ST.supportView}. ${ST.supportViewWhy}`}>{ST.supportView}</button>
            </span>
            <div>
              <b className="hint">{ST.satisfaction}</b>
              <div>{r.rating ? `${r.rating} / 5${r.rating_comment ? ` - ${r.rating_comment}` : ""}` : <span className="hint">{ST.noRating}</span>}</div>
            </div>
          </section>

          {ctx.length > 0 && (
            <section className="panel pane" style={{ padding: 14 }}>
              <h2>{ST.context}</h2>
              <dl style={{ margin: 0, display: "grid", gap: 4, fontSize: 13 }}>
                {ctx.map((l) => <div key={l.key}><dt className="hint">{l.key}</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }} dir="ltr">{l.value}</dd></div>)}
              </dl>
            </section>
          )}

          {canWrite && (
            <section className="panel pane" style={{ padding: 14 }}>
              {customer.signed_in && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void run(async () => { await staffSupportApi.startChat(id); return null; }, ST.saved)}>{ST.startChat}</button>}
              <label className="fg"><b>{ST.mergeInto}</b><input value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} dir="ltr" /></label>
              <div><button type="button" className="btn ghost sm" disabled={busy || !mergeInto.trim()} onClick={() => void run(() => staffSupportApi.merge(id, mergeInto.trim()))}>{ST.mergeDo}</button></div>
              <label className="chkrow"><input type="checkbox" checked={r.spam} onChange={(e) => patch({ spam: e.target.checked })} /><span>{ST.spam}</span></label>
            </section>
          )}
          {role === "admin" && (
            <section className="panel pane" style={{ padding: 14 }}>
              <b>{ST.ban}</b>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <label className="fg"><span>{ST.banDays}</span><input type="number" min={1} max={365} value={banDays} onChange={(e) => setBanDays(Number(e.target.value))} style={{ width: 80 }} /></label>
                <label className="fg" style={{ flex: 1 }}><span>{ST.banReason}</span><input value={banReason} onChange={(e) => setBanReason(e.target.value)} maxLength={200} /></label>
              </div>
              <div><button type="button" className="btn danger sm" disabled={busy} onClick={() => void run(async () => { await staffSupportApi.ban({ ticket_id: id, days: banDays, reason: banReason }); return null; }, ST.banDone)}>{ST.ban}</button></div>
            </section>
          )}
        </aside>
      </div>
      <style>{`@media(max-width:900px){.stk{grid-template-columns:1fr !important}}`}</style>
    </div>
  );
}
