"use client";

// Event mode: full-screen QR for a conference, quick "I met someone" notes that queue while offline, and the end-of-event summary.
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Empty, ErrorBox, PageHead, SkeletonBlocks } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { Icon } from "@/components/Icon";
import { useCards } from "@/lib/hooks";
import { defaultFirst } from "@/lib/card-order";
import { useI18n } from "@/lib/i18n/client";
import { eventNames, summarise, toCsv, type EventNote } from "@/lib/event/notes";
import { CSV_HEADER, TAG_NAMES } from "@/lib/event/labels";
import { useEventNotes } from "@/lib/event/use-notes";
import { loadOfflineQrs } from "@/lib/pwa/store";
import { readStoredStyle, saveBlob } from "@/lib/qr/client";
import { MeetMode, type MeetCard } from "./MeetMode";
import { QuickNote } from "./QuickNote";
import styles from "./event.module.css";

export default function EventPage() {
  return (
    <Suspense fallback={<div className="view"><SkeletonBlocks rows={3} /></div>}>
      <EventInner />
    </Suspense>
  );
}

function EventInner() {
  const { current } = useWs();
  const { t, number, date } = useI18n();
  const cards = useCards(current.id);
  const notes = useEventNotes(current.id);
  const [meet, setMeet] = useState(false);
  const [cardId, setCardId] = useState("");
  const [saved, setSaved] = useState<MeetCard[]>([]);
  const [summaryEvent, setSummaryEvent] = useState<string | null>(null);

  // Cards saved on this device (by the QR page): what Meet mode shows when the cards cannot be fetched.
  useEffect(() => {
    let live = true;
    void loadOfflineQrs().then((list) => live && setSaved(list.map((e) => ({ id: e.id, name: e.name, title: e.title, company: e.company, linkText: e.linkText, style: e.style }))));
    return () => {
      live = false;
    };
  }, []);

  const live = useMemo<MeetCard[]>(
    () => defaultFirst(cards.data ?? []).filter((c) => c.status === "published").map((c) => ({ id: c.id, name: c.name, title: c.title, company: c.company, linkText: `${c.public_url}?s=qr`, style: readStoredStyle(c.id) })),
    [cards.data],
  );
  const offlineCards = live.length === 0 && saved.length > 0 && !!cards.error;
  const meetCards = live.length > 0 ? live : offlineCards ? saved : [];
  const startIndex = Math.max(0, meetCards.findIndex((c) => c.id === cardId));

  const eventList = useMemo(() => {
    const names = eventNames(notes.notes);
    return names.includes(notes.eventName) || !notes.eventName ? names : [notes.eventName, ...names];
  }, [notes.notes, notes.eventName]);
  const shownEvent = summaryEvent ?? (eventList.includes(notes.eventName) ? notes.eventName : eventList[0] ?? "");
  const summary = summarise(notes.notes, shownEvent);
  const shownNotes = notes.notes.filter((n) => n.eventName === shownEvent).sort((a, b) => b.createdAt - a.createdAt);
  const eventLabel = (n: string) => n || t("growth.eventNoEvent");

  function exportCsv() {
    const header = CSV_HEADER.map((k) => t(k));
    const csv = toCsv(notes.notes, shownEvent, (tag) => (tag ? t(TAG_NAMES[tag]) : ""), header, { yes: t("growth.eventCsvYes"), no: t("growth.eventCsvNo") });
    const slug = (shownEvent || "event").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase() || "event";
    saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${slug}-contacts.csv`);
  }

  if (cards.isLoading && saved.length === 0) return <div className="view"><SkeletonBlocks rows={3} /></div>;

  const cardChoices = meetCards;
  const noteCard = cardId || cardChoices[0]?.id || null;

  return (
    <div className="view">
      <PageHead title={t("growth.eventTitle")} sub={t("growth.eventSub")}>
        <SyncChip notes={notes} />
      </PageHead>

      {cards.error && !offlineCards && <ErrorBox error={cards.error} onRetry={() => void cards.refetch()} />}

      <div className="g3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))" }}>
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="qr" size="s" /></span>{t("growth.eventMeetHead")}</h2></div>
          <p style={{ margin: 0 }}>{t("growth.eventMeetText")}</p>
          {meetCards.length === 0 ? (
            <Empty title={t("growth.eventNoCard")} action={<Link className="btn sm" href="/app/cards">{t("tools.qrCreate")}</Link>}>{null}</Empty>
          ) : (
            <>
              {meetCards.length > 1 && (
                <label style={{ maxWidth: 420 }}>
                  {t("tools.qrCard")}
                  <select value={cardId || meetCards[0].id} onChange={(e) => setCardId(e.target.value)}>
                    {meetCards.map((c) => <option key={c.id} value={c.id}>{c.name || t("tools.qrUntitled")}</option>)}
                  </select>
                </label>
              )}
              {offlineCards && <div className="hint">{t("growth.eventOfflineCards")}</div>}
              <button type="button" className="btn" onClick={() => setMeet(true)} data-guide="event-start"><Icon name="scan" size="s" />{t("growth.eventStart")}</button>
            </>
          )}
        </div>

        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="adduser" size="s" /></span>{t("growth.eventNoteHead")}</h2></div>
          <p className="hint" style={{ margin: 0 }}>{t("growth.eventNoteText")}</p>
          <QuickNote cardId={noteCard} add={notes.add} eventName={notes.eventName} setEventName={notes.setEventName} />
        </div>
      </div>

      <div className="panel card">
        <div className="head">
          <h2><span className="chip"><Icon name="chart" size="s" /></span>{t("growth.eventSummaryHead")}</h2>
          <button type="button" className="btn ghost sm" disabled={summary.total === 0} onClick={exportCsv}><Icon name="download" size="s" />{t("growth.eventExport")}</button>
        </div>
        {eventList.length > 1 && (
          <label style={{ maxWidth: 360 }}>
            {t("growth.eventSummaryEvent")}
            <select value={shownEvent} onChange={(e) => setSummaryEvent(e.target.value)}>
              {eventList.map((n) => <option key={n} value={n}>{eventLabel(n)}</option>)}
            </select>
          </label>
        )}
        {summary.total === 0 ? (
          <div className="hint">{t("growth.eventSummaryEmpty")}</div>
        ) : (
          <>
            <div className={styles.counts}>
              <span className="pill dark"><b>{t("growth.eventSummaryTotal", { n: number(summary.total) })}</b></span>
              {(["hot", "warm", "follow_up", "none"] as const).map((k) => summary.byTag[k] > 0 && (
                <span key={k} className="pill">{t(TAG_NAMES[k === "none" ? "" : k])}: {number(summary.byTag[k])}</span>
              ))}
            </div>
            <ul className={styles.notes}>
              {shownNotes.slice(0, 50).map((n) => <NoteRow key={n.ref} n={n} when={date(new Date(n.createdAt).toISOString())} onRetry={() => notes.retry(n.ref)} />)}
            </ul>
            <div><Link className="btn ghost sm" href="/app/contacts">{t("growth.eventContacts")}</Link></div>
          </>
        )}
      </div>

      {meet && meetCards.length > 0 && (
        <MeetMode cards={meetCards} start={startIndex} offlineCards={offlineCards} onClose={() => setMeet(false)} notes={notes} />
      )}
    </div>
  );
}

function SyncChip({ notes }: { notes: ReturnType<typeof useEventNotes> }) {
  const { t, number } = useI18n();
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className={`pill ${notes.online ? "" : "warn"}`}>{notes.online ? t("growth.eventOnline") : t("growth.eventOffline")}</span>
      <span className={`pill ${notes.waitingCount ? "warn" : ""}`} role="status" aria-live="polite">{notes.waitingCount ? t("growth.eventWaiting", { n: number(notes.waitingCount) }) : t("growth.eventAllSent")}</span>
      {notes.waitingCount > 0 && notes.online && <button type="button" className="btn ghost sm" disabled={notes.syncing} onClick={() => void notes.sync()}>{t("growth.eventSyncNow")}</button>}
    </span>
  );
}

function NoteRow({ n, when, onRetry }: { n: EventNote; when: string; onRetry: () => void }) {
  const { t } = useI18n();
  const state = n.state === "synced" ? t("growth.eventStateSynced") : n.state === "rejected" ? t("growth.eventStateRejected") : t("growth.eventStateWaiting");
  return (
    <li className={styles.noteRow}>
      <div>
        <b dir="auto">{n.name || n.company || n.email || n.phone || t("growth.eventUnnamed")}</b>
        <div className="hint" dir="auto">{[n.company && n.name ? n.company : "", n.tag ? t(TAG_NAMES[n.tag]) : "", when].filter(Boolean).join(" - ")}</div>
        {n.state === "rejected" && n.error && <div className="err" dir="auto">{n.error}</div>}
      </div>
      <span className="row" style={{ gap: 8, flex: "none" }}>
        <span className={`pill ${n.state === "waiting" ? "warn" : n.state === "rejected" ? "bad" : "ok"}`}>{state}</span>
        {n.state === "rejected" && <button type="button" className="btn ghost sm" onClick={onRetry}>{t("growth.eventRetry")}</button>}
      </span>
    </li>
  );
}
