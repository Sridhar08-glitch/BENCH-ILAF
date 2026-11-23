"use client";

// The chat itself. Messages travel by short polling with a `since` cursor and an ETag: every 2 seconds while the person looks at
// it, every 8 seconds while the tab is hidden, backing off after errors, and stopping after a long quiet time.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ApiError } from "@/lib/api";
import { tk, type MessageKey } from "@/lib/i18n";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { chatApi } from "@/lib/support/api";
import { captureContext } from "@/lib/support/context";
import { isIdle, mergeMessages, nextCursor, pollDelay, shouldSendTyping } from "@/lib/support/poll";
import type { ChatMessage, ChatPoll, ChatState, ChatStatus } from "@/lib/support/types";
import { MAX_CHAT_BODY, checkFiles, chatBodyOk, validEmail, type FileErrorKey } from "@/lib/support/validation";
import { MessageText } from "./shared";
import s from "./support.module.css";

const STORE = "support:chat";
const SYSTEM_KEYS: Record<string, MessageKey> = {
  accepted: tk("support.chat.sys.accepted"), transferred: tk("support.chat.sys.transferred"), ended: tk("support.chat.sys.ended"),
  converted: tk("support.chat.sys.converted"), started: tk("support.chat.sys.started"),
};
const FILE_ERR: Record<FileErrorKey, MessageKey> = {
  tooManyFiles: tk("support.err.tooManyFiles"), fileTooBig: tk("support.err.fileTooBig"), fileType: tk("support.err.fileType"),
};

interface Session { id: string; token: string | null }
function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function saveSession(v: Session | null) {
  try {
    if (v) sessionStorage.setItem(STORE, JSON.stringify(v));
    else sessionStorage.removeItem(STORE);
  } catch {
    /* private window: the chat is lost on reload */
  }
}

export default function ChatPanel({ open, onClose, joinId, workspaceId }: { open: boolean; onClose: () => void; joinId: string | null; workspaceId?: string }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<"loading" | "start" | "chat" | "sent">("loading");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<ChatState>("waiting");
  const [typing, setTyping] = useState(false);
  const [staffName, setStaffName] = useState("");
  const [readId, setReadId] = useState(0);
  const [ticket, setTicket] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [first, setFirst] = useState("");
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [offlineNet, setOfflineNet] = useState(false);
  const [paused, setPaused] = useState(false);
  const cursor = useRef(0);
  const etag = useRef<string | null>(null);
  const lastActivity = useRef(Date.now());
  const lastTyping = useRef(0);
  const pollNow = useRef<() => void>(() => undefined);
  const logRef = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Find out who is online, or pick up a chat that is already running (this tab's, or one the team started).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = joinId ? { id: joinId, token: null } : loadSession();
      try {
        const st = await chatApi.status(workspaceId);
        if (cancelled) return;
        setStatus(st);
        const resume = saved ?? (st.open_chat_id ? { id: st.open_chat_id, token: null } : null);
        if (resume) {
          setSession(resume);
          setPhase("chat");
        } else setPhase("start");
      } catch (e) {
        if (!cancelled) {
          setProblem(apiErrorText(e, t, "support.chat.errorStart"));
          setPhase("start");
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinId]);

  const apply = useCallback((d: ChatPoll) => {
    setState(d.status);
    setTyping(d.typing);
    setStaffName(d.staff_name);
    setReadId(d.read_id);
    if (d.ticket) setTicket(d.ticket);
    if (d.messages.length > 0) {
      lastActivity.current = Date.now();
      cursor.current = nextCursor(cursor.current, d.messages);
      setMessages((list) => mergeMessages(list, d.messages));
    }
  }, []);

  // The polling loop.
  useEffect(() => {
    if (phase !== "chat" || !session || paused) return;
    let stop = false;
    let failures = 0;
    let timer: number | undefined;
    const tick = async () => {
      window.clearTimeout(timer);
      try {
        const r = await chatApi.poll(session.id, cursor.current, session.token, etag.current);
        failures = 0;
        setOfflineNet(false);
        if (!r.notModified) {
          etag.current = r.etag;
          apply(r.data);
          if (r.data.status === "ended" || r.data.status === "offline_converted") {
            saveSession(null);
            return; // nothing more will happen in this chat
          }
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          saveSession(null);
          setSession(null);
          setPhase("start");
          return;
        }
        failures += 1;
        setOfflineNet(true);
      }
      if (stop) return;
      if (isIdle(lastActivity.current, Date.now())) {
        setPaused(true);
        return;
      }
      const focused = open && document.visibilityState === "visible";
      timer = window.setTimeout(() => void tick(), pollDelay({ focused, failures }));
    };
    pollNow.current = () => void tick();
    void tick();
    return () => { stop = true; window.clearTimeout(timer); };
  }, [phase, session, paused, open, apply]);

  // Focus: into the panel when it opens; Escape closes it.
  useEffect(() => {
    if (open) window.setTimeout(() => firstField.current?.focus(), 50);
  }, [open, phase]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages.length, typing]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setProblem("");
    const signedIn = status?.signed_in ?? false;
    if (!signedIn && (!name.trim() || !validEmail(email))) { setProblem(t("support.err.emailInvalid")); return; }
    if (!online && !first.trim()) { setProblem(t("support.err.bodyRequired")); return; }
    setBusy(true);
    try {
      const made = await chatApi.start({ name: name.trim(), email: email.trim(), message: first.trim(), context: captureContext({ language: locale, workspaceId }) });
      if (made.status === "offline_converted" || made.converted_to_ticket) {
        setTicket(made.ticket ?? null);
        setPhase("sent");
        return;
      }
      const next = { id: made.id, token: made.token ?? null };
      saveSession(next);
      cursor.current = 0;
      etag.current = null;
      setMessages([]);
      lastActivity.current = Date.now();
      setSession(next);
      setPaused(false);
      setPhase("chat");
    } catch (x) {
      if (x instanceof ApiError && x.code === "support_chat_open_exists" && x.fields.chat_id?.[0]) {
        setSession({ id: x.fields.chat_id[0], token: null });
        setPhase("chat");
      } else setProblem(apiErrorText(x, t, "support.chat.errorStart"));
    } finally {
      setBusy(false);
    }
  }

  async function send(e: React.FormEvent, files: File[] = []) {
    e.preventDefault();
    if (!session || (!chatBodyOk(draft) && files.length === 0)) return;
    setBusy(true);
    setProblem("");
    try {
      await chatApi.send(session.id, draft.trim(), files, session.token);
      setDraft("");
      lastActivity.current = Date.now();
      setPaused(false);
      pollNow.current();
    } catch (x) {
      setProblem(apiErrorText(x, t, "support.chat.errorSend"));
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    if (!session) return;
    try {
      await chatApi.end(session.id, session.token);
    } catch {
      /* already over */
    }
    saveSession(null);
    setState("ended");
    pollNow.current();
  }

  function attach(list: FileList | null) {
    const chosen = Array.from(list ?? []).slice(0, 1);
    const bad = checkFiles(chosen);
    if (bad) { setProblem(t(FILE_ERR[bad])); return; }
    if (chosen.length) void send({ preventDefault: () => undefined } as React.FormEvent, chosen);
  }

  const online = !!(status?.live ?? status?.online);
  const over = state === "ended" || state === "offline_converted";
  const signedIn = !!status?.signed_in;

  return (
    <div
      ref={panel}
      className={s.chat}
      role="dialog"
      aria-labelledby="support-chat-title"
      hidden={!open}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
    >
      <div className={s.chathead}>
        <span className={`${s.dot} ${online ? s.on : ""}`} aria-hidden="true" />
        <div className="grow" style={{ flex: 1 }}>
          <b id="support-chat-title">{t("support.chat.title")}</b>
          <small>{status === null ? t("support.chat.checking") : online ? t("support.chat.online") : t("support.chat.offline")}</small>
        </div>
        <button type="button" className={s.panelbtn} aria-label={t("support.chat.close")} onClick={onClose}><Icon name="x" size="s" /></button>
      </div>

      <div className={s.chatbody} ref={logRef} role="log" aria-live="polite">
        {phase === "loading" && <span className="hint" role="status">{t("support.chat.checking")}</span>}

        {phase === "start" && (
          <form onSubmit={(e) => void start(e)} className="pane" style={{ gap: 10 }} noValidate>
            <p style={{ margin: 0 }}>{status && !status.enabled ? t("support.chat.disabledText") : online ? t("support.chat.firstMessage") : t("support.chat.offlineText")}</p>
            {!signedIn && (
              <>
                <label className="fg"><b>{t("support.fName")}</b><input ref={firstField as React.RefObject<HTMLInputElement>} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" /></label>
                <label className="fg"><b>{t("support.fEmail")}</b><input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" /></label>
              </>
            )}
            <label className="fg">
              <b>{t("support.fMessage")}</b>
              <textarea ref={signedIn ? (firstField as React.RefObject<HTMLTextAreaElement>) : undefined} rows={4} value={first} maxLength={MAX_CHAT_BODY} placeholder={t("support.chat.firstMessage")} onChange={(e) => setFirst(e.target.value)} />
            </label>
            <button className="btn" disabled={busy || !status}>{online ? t("support.chat.start") : t("support.chat.sendMessage")}</button>
          </form>
        )}

        {phase === "sent" && (
          <div className="pane" role="status">
            <p style={{ margin: 0 }}>{t("support.chat.sentTicket", { ticket: ticket ?? "" })}</p>
            {signedIn && <Link className="btn ghost sm" href="/app/support">{t("support.backToList")}</Link>}
            <button type="button" className="btn ghost sm" onClick={() => { setPhase("start"); setFirst(""); setTicket(null); }}>{t("support.chat.newChat")}</button>
          </div>
        )}

        {phase === "chat" && (
          <>
            {state === "waiting" && !over && <div className={s.sys}>{t("support.chat.waiting", { n: status?.accept_seconds ?? 120 })}</div>}
            {state === "active" && staffName && messages.every((m) => m.author !== "system") && <div className={s.sys}>{t("support.chat.joined", { name: staffName })}</div>}
            {messages.map((m) =>
              m.author === "system" ? (
                <div key={m.id} className={s.sys}>{SYSTEM_KEYS[m.body] ? t(SYSTEM_KEYS[m.body]) : m.body}</div>
              ) : (
                <div key={m.id} className={`${s.bubble} ${m.author === "customer" ? s.me : s.them}`}>
                  {m.author === "staff" && m.author_name && <small>{m.author_name}</small>}
                  <MessageText text={m.body} />
                  {m.files.map((f) => (signedIn ? <a key={f.id} className={s.file} href={chatApi.fileUrl(session?.id ?? "", f.id)} target="_blank" rel="noopener noreferrer">{f.name}</a> : <span key={f.id} className={s.file}>{f.name}</span>))}
                  {m.author === "customer" && m.id <= readId && <small>{t("support.chat.seen")}</small>}
                </div>
              ),
            )}
            {state === "offline_converted" && <div className={s.sys}>{t("support.chat.converted", { ticket: ticket ?? "" })}</div>}
            {state === "ended" && <div className={s.sys}>{t("support.chat.ended")}</div>}
            {offlineNet && <div className={s.sys} role="status">{t("support.chat.connection")}</div>}
            {paused && (
              <div className={s.sys}>
                {t("support.chat.paused")} <button type="button" className="linkbtn" onClick={() => { lastActivity.current = Date.now(); setPaused(false); }}>{t("support.chat.resume")}</button>
              </div>
            )}
          </>
        )}
      </div>

      {phase === "chat" && !over && (
        <form className={s.chatform} onSubmit={(e) => void send(e)}>
          <div className={s.typing} aria-live="polite">{typing ? (staffName ? t("support.chat.typing", { name: staffName }) : t("support.chat.typingGeneric")) : ""}</div>
          {problem && <span className="err" role="alert">{problem}</span>}
          <textarea
            ref={firstField as React.RefObject<HTMLTextAreaElement>}
            rows={2}
            value={draft}
            maxLength={MAX_CHAT_BODY}
            placeholder={t("support.chat.messagePh")}
            aria-label={t("support.chat.messagePh")}
            onChange={(e) => {
              setDraft(e.target.value);
              const now = Date.now();
              if (session && shouldSendTyping(lastTyping.current, now)) {
                lastTyping.current = now;
                void chatApi.typing(session.id, session.token).catch(() => undefined);
              }
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) void send(e as unknown as React.FormEvent); }}
          />
          <div className="row">
            <label className={s.panelbtn} style={{ cursor: "pointer", color: "var(--ink)" }}>
              <Icon name="upload" size="s" /><span className="sr-only">{t("support.chat.attach")}</span>
              <input type="file" hidden accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.log" onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />
            </label>
            <span className="grow" />
            <button type="button" className="btn ghost sm" onClick={() => void end()}>{t("support.chat.end")}</button>
            <button className="btn sm" disabled={busy || !chatBodyOk(draft)}>{t("support.chat.send")}</button>
          </div>
        </form>
      )}
      {phase === "chat" && over && (
        <div className={s.chatform}>
          <button type="button" className="btn sm" onClick={() => { setPhase("start"); setSession(null); setMessages([]); cursor.current = 0; etag.current = null; setState("waiting"); setFirst(""); }}>{t("support.chat.newChat")}</button>
        </div>
      )}
    </div>
  );
}
