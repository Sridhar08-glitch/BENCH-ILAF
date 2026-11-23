"use client";

// Support settings: business hours and holidays, chat on or off, automatic replies in English and Arabic, deadlines per priority,
// saved replies, blocked words, blocked visitors, and the state of the support mailbox. Only admins can change them.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import { SupportTabs } from "@/components/staff-support/parts";
import { staffApi } from "@/lib/designs/api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { staffSupportApi } from "@/lib/support/api";
import { ST } from "@/lib/support/staff-text";
import { PRIORITIES, type Canned, type DayHours, type SupportSettings } from "@/lib/support/types";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export default function SupportSettingsPage() {
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["staff-me"], queryFn: staffApi.me });
  const isAdmin = me.data?.staff_role === "admin";
  const q = useQuery({ queryKey: ["staff-support-settings"], queryFn: staffSupportApi.settings });
  const canned = useQuery({ queryKey: ["staff-canned"], queryFn: staffSupportApi.canned });
  const bans = useQuery({ queryKey: ["staff-bans"], queryFn: staffSupportApi.bans });
  const [f, setF] = useState<SupportSettings | null>(null);
  const [holidays, setHolidays] = useState("");
  const [blocked, setBlocked] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Partial<Canned> & { title: string; body_en: string }>({ title: "", body_en: "", body_ar: "" });

  useEffect(() => {
    if (q.data) {
      setF(q.data);
      setHolidays(q.data.holidays.join("\n"));
      setBlocked(q.data.blocked_words.join("\n"));
    }
  }, [q.data]);

  if (q.isLoading || !f) return <div className="view"><SkeletonBlocks rows={4} /></div>;
  if (q.error) return <div className="view"><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></div>;
  const set = <K extends keyof SupportSettings>(k: K, v: SupportSettings[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const lines = (text: string) => text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const setDay = (day: string, hours: DayHours) => set("business_hours", { ...f.business_hours, [day]: hours });

  async function save() {
    setBusy(true);
    setProblem("");
    try {
      const out = await staffSupportApi.saveSettings({
        timezone: f!.timezone, business_hours: Object.fromEntries(Object.entries(f!.business_hours).filter(([, v]) => v.length > 0)), holidays: lines(holidays), chat_enabled: f!.chat_enabled,
        chat_accept_seconds: f!.chat_accept_seconds, auto_reply_en: f!.auto_reply_en, auto_reply_ar: f!.auto_reply_ar, offline_reply_en: f!.offline_reply_en,
        offline_reply_ar: f!.offline_reply_ar, sla: f!.sla, blocked_words: lines(blocked), inbound_address: f!.inbound_address,
      });
      qc.setQueryData(["staff-support-settings"], out);
      toast(ST.saved);
    } catch (e) {
      setProblem(apiErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  const dis = !isAdmin || busy;
  return (
    <div className="view">
      <h1>{ST.settingsTitle}</h1>
      <SupportTabs />
      {!isAdmin && <div className="notice" role="note"><div className="grow">{ST.adminOnly}</div></div>}
      {problem && <div className="notice bad" role="alert"><div className="grow">{problem}</div></div>}

      <section className="panel pane" style={{ padding: 14 }}>
        <h2>{ST.hours}</h2>
        <span className="hint">{ST.hoursHelp}</span>
        <label className="fg" style={{ maxWidth: 280 }}><b>{ST.tz}</b><input value={f.timezone} disabled={dis} onChange={(e) => set("timezone", e.target.value)} dir="ltr" /></label>
        {DAYS.map((day) => {
          const windows = f.business_hours[day] ?? [];
          return (
            <div key={day} className="row" style={{ flexWrap: "wrap" }}>
              <b style={{ width: 100 }}>{ST.days[day]}</b>
              {windows.length === 0 && <span className="hint">{ST.closed}</span>}
              {windows.map((w, i) => (
                <span key={i} className="row" style={{ gap: 4 }}>
                  <input type="time" aria-label={`${ST.days[day]} start`} value={w[0]} disabled={dis} onChange={(e) => setDay(day, windows.map((x, k) => (k === i ? [e.target.value, x[1]] : x)) as DayHours)} />
                  <span>-</span>
                  <input type="time" aria-label={`${ST.days[day]} end`} value={w[1]} disabled={dis} onChange={(e) => setDay(day, windows.map((x, k) => (k === i ? [x[0], e.target.value] : x)) as DayHours)} />
                  <button type="button" className="linkbtn" disabled={dis} aria-label={`Remove ${ST.days[day]} hours`} onClick={() => setDay(day, windows.filter((_, k) => k !== i) as DayHours)}>x</button>
                </span>
              ))}
              <button type="button" className="btn ghost sm" disabled={dis || windows.length >= 4} onClick={() => setDay(day, [...windows, ["09:00", "17:00"]] as DayHours)}>{ST.addWindow}</button>
            </div>
          );
        })}
        <label className="fg"><b>{ST.holidays}</b><textarea rows={4} value={holidays} disabled={dis} onChange={(e) => setHolidays(e.target.value)} dir="ltr" /></label>
      </section>

      <section className="panel pane" style={{ padding: 14 }}>
        <h2>{ST.chat}</h2>
        <label className="chkrow"><input type="checkbox" checked={f.chat_enabled} disabled={dis} onChange={(e) => set("chat_enabled", e.target.checked)} /><span>{ST.chatOn}</span></label>
        <label className="fg" style={{ maxWidth: 360 }}><b>{ST.acceptSeconds}</b><input type="number" min={30} max={600} value={f.chat_accept_seconds} disabled={dis} onChange={(e) => set("chat_accept_seconds", Number(e.target.value))} /></label>
      </section>

      <section className="panel pane" style={{ padding: 14 }}>
        <h2>{ST.autoReplies}</h2>
        <label className="fg"><b>{ST.autoEn}</b><textarea rows={3} value={f.auto_reply_en} disabled={dis} onChange={(e) => set("auto_reply_en", e.target.value)} /></label>
        <label className="fg"><b>{ST.autoAr}</b><textarea rows={3} dir="rtl" value={f.auto_reply_ar} disabled={dis} onChange={(e) => set("auto_reply_ar", e.target.value)} /></label>
        <label className="fg"><b>{ST.offlineEn}</b><textarea rows={3} value={f.offline_reply_en} disabled={dis} onChange={(e) => set("offline_reply_en", e.target.value)} /></label>
        <label className="fg"><b>{ST.offlineAr}</b><textarea rows={3} dir="rtl" value={f.offline_reply_ar} disabled={dis} onChange={(e) => set("offline_reply_ar", e.target.value)} /></label>
      </section>

      <section className="panel pane" style={{ padding: 14 }}>
        <h2>{ST.sla}</h2>
        <table><thead><tr><th style={{ textAlign: "start" }}>{ST.priority}</th><th style={{ textAlign: "start" }}>{ST.slaFirst}</th><th style={{ textAlign: "start" }}>{ST.slaResolve}</th></tr></thead>
          <tbody>
            {PRIORITIES.map((p) => (
              <tr key={p}>
                <td>{ST.priorities[p]}</td>
                <td><input type="number" min={1} aria-label={`${ST.priorities[p]} ${ST.slaFirst}`} value={f.sla[p]?.first ?? 0} disabled={dis} onChange={(e) => set("sla", { ...f.sla, [p]: { ...f.sla[p], first: Number(e.target.value) } })} /></td>
                <td><input type="number" min={1} aria-label={`${ST.priorities[p]} ${ST.slaResolve}`} value={f.sla[p]?.resolve ?? 0} disabled={dis} onChange={(e) => set("sla", { ...f.sla, [p]: { ...f.sla[p], resolve: Number(e.target.value) } })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel pane" style={{ padding: 14 }}>
        <h2>{ST.blocked}</h2>
        <textarea rows={4} value={blocked} disabled={dis} onChange={(e) => setBlocked(e.target.value)} aria-label={ST.blocked} />
        <label className="fg" style={{ maxWidth: 360 }}><b>{ST.inboundAddress}</b><input value={f.inbound_address} disabled={dis} onChange={(e) => set("inbound_address", e.target.value)} dir="ltr" /></label>
      </section>

      <div><button className="btn" disabled={dis} onClick={() => void save()}>{ST.save}</button></div>

      <section className="panel pane" style={{ padding: 14 }}>
        <h2>{ST.cannedTitle}</h2>
        <span className="hint">{ST.cannedHelp}</span>
        {(canned.data ?? []).map((c) => (
          <div key={c.id} className="row" style={{ flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <b className="grow">{c.title}</b>
            <button type="button" className="btn ghost sm" disabled={!isAdmin} onClick={() => setDraft(c)}>{ST.open}</button>
            <button type="button" className="btn danger sm" disabled={!isAdmin} onClick={() => void staffSupportApi.deleteCanned(c.id).then(() => qc.invalidateQueries({ queryKey: ["staff-canned"] })).catch((e) => setProblem(apiErrorText(e, t)))}>{ST.cannedDelete}</button>
          </div>
        ))}
        <label className="fg"><b>{ST.cannedName}</b><input value={draft.title} disabled={!isAdmin} maxLength={80} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
        <label className="fg"><b>{ST.cannedEn}</b><textarea rows={3} value={draft.body_en} disabled={!isAdmin} onChange={(e) => setDraft({ ...draft, body_en: e.target.value })} /></label>
        <label className="fg"><b>{ST.cannedAr}</b><textarea rows={3} dir="rtl" value={draft.body_ar ?? ""} disabled={!isAdmin} onChange={(e) => setDraft({ ...draft, body_ar: e.target.value })} /></label>
        <div><button type="button" className="btn sm" disabled={!isAdmin || !draft.title.trim() || !draft.body_en.trim()} onClick={() => void staffSupportApi.saveCanned(draft).then(() => { setDraft({ title: "", body_en: "", body_ar: "" }); toast(ST.saved); return qc.invalidateQueries({ queryKey: ["staff-canned"] }); }).catch((e) => setProblem(apiErrorText(e, t)))}>{draft.id ? ST.save : ST.cannedAdd}</button></div>
      </section>

      <section className="panel pane" style={{ padding: 14 }}>
        <h2>{ST.bans}</h2>
        {(bans.data ?? []).length === 0 && <span className="hint">{ST.noBans}</span>}
        {(bans.data ?? []).map((b) => (
          <div key={b.id} className="row" style={{ flexWrap: "wrap" }}>
            <code>{b.ip_hash.slice(0, 8)}</code><span className="hint">{b.reason}</span><span className="hint">{ST.expires} {dateTime(b.expires_at)}</span><span className="grow" />
            <button type="button" className="btn ghost sm" disabled={!isAdmin} onClick={() => void staffSupportApi.unban(b.id).then(() => qc.invalidateQueries({ queryKey: ["staff-bans"] })).catch((e) => setProblem(apiErrorText(e, t)))}>{ST.unban}</button>
          </div>
        ))}
      </section>

      <section className="panel pane" style={{ padding: 14 }}>
        <h2>{ST.inboundTitle}</h2>
        <span className="hint">{ST.inboundHelp}</span>
        <dl style={{ margin: 0, display: "grid", gap: 6 }}>
          <div><dt className="hint">{ST.replyTo}</dt><dd style={{ margin: 0 }} dir="ltr">{f.mail.reply_to || "-"}</dd></div>
          <div><dt className="hint">{ST.imap}</dt><dd style={{ margin: 0 }}>{f.mail.imap_configured ? `${ST.imapOn} (${f.mail.imap_folder})` : ST.imapOff}</dd></div>
          <div><dt className="hint">{ST.webhook}</dt><dd style={{ margin: 0 }} dir="ltr">{f.mail.webhook_path} - {f.mail.webhook_secret_set ? ST.webhookOn : ST.webhookOff}</dd></div>
          <div><dt className="hint">{ST.prefix}</dt><dd style={{ margin: 0 }} dir="ltr">{f.mail.ticket_prefix}</dd></div>
        </dl>
      </section>
    </div>
  );
}
