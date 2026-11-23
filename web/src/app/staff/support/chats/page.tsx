"use client";

// The live chat console: your status, the waiting and active chats, and one conversation at a time.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorBox, SkeletonBlocks } from "@/components/app/ui";
import { SupportTabs } from "@/components/staff-support/parts";
import { MessageText } from "@/components/support/shared";
import { staffApi } from "@/lib/designs/api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { staffSupportApi } from "@/lib/support/api";
import { mergeMessages, nextCursor, pollDelay, shouldSendTyping } from "@/lib/support/poll";
import { ST } from "@/lib/support/staff-text";
import type { ChatMessage, StaffChat } from "@/lib/support/types";
import s from "@/components/support/support.module.css";

const HEARTBEAT_MS = 30_000;
const PREF = "support:console";

function readPref(): { sound: boolean; notify: boolean } {
  try {
    return { sound: false, notify: false, ...(JSON.parse(localStorage.getItem(PREF) ?? "{}") as object) };
  } catch {
    return { sound: false, notify: false };
  }
}

/** A short beep made with the browser's own audio, so no sound file is needed. */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => void ctx.close();
  } catch {
    /* no audio available */
  }
}

export default function ChatConsolePage() {
  const { t, dateTime } = useI18n();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["staff-me"], queryFn: staffApi.me });
  const canWrite = me.data?.staff_role === "support" || me.data?.staff_role === "admin";
  const list = useQuery({ queryKey: ["staff-chats"], queryFn: staffSupportApi.chats, refetchInterval: 3000, placeholderData: (p) => p });
  const agents = useQuery({ queryKey: ["staff-agents"], queryFn: staffSupportApi.agents });
  const [pick, setPick] = useState<string | null>(null);
  const [pref, setPref] = useState(readPref);
  const [problem, setProblem] = useState("");
  const [permission, setPermission] = useState<NotificationPermission | "none">("none");
  const seenWaiting = useRef<Set<string> | null>(null);
  const presence = list.data?.presence;

  useEffect(() => {
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);

  // A heartbeat keeps you online; after five minutes without one the server sets you to away.
  useEffect(() => {
    if (!canWrite || presence?.status !== "online") return;
    const id = window.setInterval(() => void staffSupportApi.heartbeat().catch(() => undefined), HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [canWrite, presence?.status]);

  // A new waiting chat: a sound and a desktop notice (only when the person allowed notifications).
  useEffect(() => {
    const waiting = new Set((list.data?.chats ?? []).filter((c) => c.status === "waiting").map((c) => c.id));
    if (seenWaiting.current) {
      const fresh = [...waiting].filter((id) => !seenWaiting.current?.has(id));
      if (fresh.length > 0) {
        if (pref.sound) beep();
        if (pref.notify && typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(ST.newChat);
      }
    }
    seenWaiting.current = waiting;
  }, [list.data, pref]);

  const savePref = (next: typeof pref) => {
    setPref(next);
    try {
      localStorage.setItem(PREF, JSON.stringify(next));
    } catch {
      /* not remembered */
    }
  };

  async function setStatus(status: string) {
    setProblem("");
    try {
      await staffSupportApi.setPresence(status, presence?.capacity);
      await qc.invalidateQueries({ queryKey: ["staff-chats"] });
    } catch (e) {
      setProblem(apiErrorText(e, t));
    }
  }

  async function wantNotify(on: boolean) {
    if (on && typeof Notification !== "undefined" && Notification.permission === "default") setPermission(await Notification.requestPermission());
    savePref({ ...pref, notify: on });
  }

  if (list.isLoading) return <div className="view"><SkeletonBlocks rows={3} /></div>;
  if (list.error && !list.data) return <div className="view"><ErrorBox error={list.error} onRetry={() => void list.refetch()} /></div>;
  const d = list.data!;
  const row = (c: StaffChat) => (
    <button key={c.id} type="button" className="panel" aria-pressed={pick === c.id} onClick={() => setPick(c.id)} style={{ padding: 10, textAlign: "start", display: "grid", gap: 2, borderColor: pick === c.id ? "var(--ink)" : undefined }}>
      <b dir="auto">{c.visitor}</b>
      <span className="hint" dir="auto">{c.last_message || "-"}</span>
      <span className="hint">{c.status === "waiting" ? ST.waiting : c.staff_name || ST.active} · {dateTime(c.last_activity)}</span>
    </button>
  );

  return (
    <div className="view">
      <h1>{ST.chatTitle}</h1>
      <SupportTabs />
      {problem && <div className="notice bad" role="alert"><div className="grow">{problem}</div></div>}
      {canWrite && (
        <div className="panel row" style={{ padding: 12, flexWrap: "wrap" }}>
          <b>{ST.presence}</b>
          {(["online", "away", "offline"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={presence?.status === k} className={`btn sm ${presence?.status === k ? "" : "ghost"}`} onClick={() => void setStatus(k)}>{ST[k]}</button>
          ))}
          <label className="row" style={{ gap: 6 }}>
            <span>{ST.capacity}</span>
            <input type="number" min={1} max={10} value={presence?.capacity ?? 3} style={{ width: 64 }} onChange={(e) => void staffSupportApi.setPresence(presence?.status ?? "offline", Number(e.target.value)).then(() => qc.invalidateQueries({ queryKey: ["staff-chats"] })).catch((x) => setProblem(apiErrorText(x, t)))} />
          </label>
          <label className="chkrow"><input type="checkbox" checked={pref.sound} onChange={(e) => { savePref({ ...pref, sound: e.target.checked }); if (e.target.checked) beep(); }} /><span>{ST.sound}</span></label>
          <label className="chkrow"><input type="checkbox" checked={pref.notify && permission === "granted"} onChange={(e) => void wantNotify(e.target.checked)} /><span>{ST.notify}</span></label>
          {permission === "denied" && <span className="hint">{ST.notifyBlocked}</span>}
          {presence?.status === "away" && <span className="hint">{ST.awayAuto}</span>}
        </div>
      )}
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(220px, 300px) minmax(0, 1fr)", alignItems: "start" }} className="cstk">
        <div className="pane">
          <h2>{ST.waiting} ({d.chats.filter((c) => c.status === "waiting").length})</h2>
          {d.chats.filter((c) => c.status === "waiting").map(row)}
          <h2>{ST.active} ({d.chats.filter((c) => c.status === "active").length})</h2>
          {d.chats.filter((c) => c.status === "active").map(row)}
          {d.chats.length === 0 && <span className="hint">{ST.noChats}</span>}
          <h2>{ST.recent}</h2>
          {d.recent.map(row)}
        </div>
        {pick ? <Conversation key={pick} id={pick} canWrite={canWrite} meId={me.data?.id} agents={(agents.data ?? []).map((a) => ({ id: a.id, name: a.name }))} /> : <div className="panel" style={{ padding: 20 }}><span className="hint">{ST.pickChat}</span></div>}
      </div>
      <style>{`@media(max-width:900px){.cstk{grid-template-columns:1fr !important}}`}</style>
    </div>
  );
}

function Conversation({ id, canWrite, meId, agents }: { id: string; canWrite: boolean; meId?: string; agents: { id: string; name: string }[] }) {
  const { t, dateTime } = useI18n();
  const qc = useQueryClient();
  const [info, setInfo] = useState<StaffChat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState("");
  const cursor = useRef(0);
  const lastTyping = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  const pollNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    let stop = false;
    let failures = 0;
    let timer: number | undefined;
    const tick = async () => {
      window.clearTimeout(timer);
      try {
        const r = await staffSupportApi.chat(id, cursor.current);
        failures = 0;
        setInfo(r);
        setTyping(r.typing);
        if (r.messages.length > 0) {
          cursor.current = nextCursor(cursor.current, r.messages);
          setMessages((l) => mergeMessages(l, r.messages));
        }
      } catch {
        failures += 1;
      }
      if (stop) return;
      timer = window.setTimeout(() => void tick(), pollDelay({ focused: document.visibilityState === "visible", failures }));
    };
    pollNow.current = () => void tick();
    void tick();
    return () => { stop = true; window.clearTimeout(timer); };
  }, [id]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages.length]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setProblem("");
    try {
      await fn();
      pollNow.current();
      await qc.invalidateQueries({ queryKey: ["staff-chats"] });
    } catch (e) {
      setProblem(apiErrorText(e, t));
    }
  }, [qc, t]);

  if (!info) return <SkeletonBlocks rows={2} />;
  const live = info.status === "waiting" || info.status === "active";
  return (
    <div className="panel" style={{ display: "grid", gridTemplateRows: "auto 1fr auto", minHeight: 420 }}>
      <div className="row" style={{ padding: 12, flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
        <div className="grow">
          <b dir="auto">{info.visitor}</b> <span className="hint" dir="ltr">{info.visitor_email}</span>
          <div className="hint">{info.signed_in ? ST.signedIn : ST.signedOut}{info.ticket ? " · " : ""}{info.ticket && info.ticket_id ? <Link href={`/staff/support/${info.ticket_id}`}>{ST.ticketLinked(info.ticket)}</Link> : null}{info.context.page_url ? ` · ${info.context.page_url}` : ""}</div>
        </div>
        {canWrite && info.status === "waiting" && <button type="button" className="btn sm" onClick={() => void act(() => staffSupportApi.chatAction(id, "accept"))}>{ST.accept}</button>}
        {canWrite && live && info.status === "active" && (
          <select aria-label={ST.transfer} value="" onChange={(e) => { if (e.target.value) void act(() => staffSupportApi.chatTransfer(id, e.target.value)); }}>
            <option value="">{ST.transfer}</option>{agents.filter((a) => a.id !== meId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {canWrite && live && <button type="button" className="btn ghost sm" onClick={() => void act(() => staffSupportApi.chatAction(id, "convert"))}>{ST.convert}</button>}
        {canWrite && live && <button type="button" className="btn danger sm" onClick={() => void act(() => staffSupportApi.chatAction(id, "end"))}>{ST.endChat}</button>}
      </div>
      <div ref={log} className={s.chatbody} role="log" aria-live="polite" style={{ maxHeight: 420 }}>
        {messages.map((m) => m.author === "system" ? (
          <div key={m.id} className={s.sys}>{ST.sys[m.body as keyof typeof ST.sys] ?? m.body}</div>
        ) : (
          <div key={m.id} className={`${s.bubble} ${m.author === "staff" ? s.me : s.them}`}><small>{m.author_name || ST.author[m.author]} · {dateTime(m.created_at)}</small><MessageText text={m.body} /></div>
        ))}
        {!live && <div className={s.sys}>{ST.chatEnded}</div>}
      </div>
      {canWrite && info.status === "active" && (
        <form className={s.chatform} onSubmit={(e) => { e.preventDefault(); if (!draft.trim()) return; const text = draft.trim(); setDraft(""); void act(() => staffSupportApi.chatSend(id, text)); }}>
          <div className={s.typing} aria-live="polite">{typing ? ST.typingNow : ""}</div>
          {problem && <span className="err" role="alert">{problem}</span>}
          <textarea rows={2} value={draft} aria-label={ST.send} maxLength={2000} dir="auto"
            onChange={(e) => { setDraft(e.target.value); const now = Date.now(); if (shouldSendTyping(lastTyping.current, now)) { lastTyping.current = now; void staffSupportApi.chatAction(id, "typing").catch(() => undefined); } }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
          <div><button className="btn sm" disabled={!draft.trim()}>{ST.send}</button></div>
        </form>
      )}
      {problem && !(canWrite && info.status === "active") && <div className="notice bad" role="alert"><div className="grow">{problem}</div></div>}
    </div>
  );
}
