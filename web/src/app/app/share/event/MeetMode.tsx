"use client";

// Meet mode: the card's QR code full screen with its owner's name, the screen kept awake, swipe between cards, and a quick note sheet.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { qrModules } from "@/lib/card/qr";
import type { EventTag } from "@/lib/event/notes";
import type { AddResult } from "@/lib/event/use-notes";
import { useI18n } from "@/lib/i18n/client";
import { qrSvg } from "@/lib/qr/render";
import { DEFAULT_STYLE, scanGuard, type QrStyle } from "@/lib/qr/style";
import { QuickNote } from "./QuickNote";
import styles from "./event.module.css";

/** What Meet mode needs of a card: from the cards list, or from the copy saved on this device when offline. */
export interface MeetCard {
  id: string;
  name: string;
  title: string;
  company: string;
  /** What a phone camera opens. */
  linkText: string;
  style: QrStyle;
}

/** The QR picture: the card's saved look when it scans well, otherwise the plain one (a bright hall is no place for a risky style). */
export function meetQr(card: MeetCard): string | null {
  const style = { ...(scanGuard(card.style).level === "ok" ? card.style : DEFAULT_STYLE), logo: "none" as const, frame: "none" as const, label: "", quiet: 2 };
  const modules = qrModules(card.linkText, "M");
  if (!modules) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(modules, style, { width: 720 }).svg)}`;
}

type WakeState = "on" | "off" | "unsupported";

/** Asks the browser to keep the screen on while `active`; asks again when the page comes back to the front. */
function useWakeLock(active: boolean): WakeState {
  const [state, setState] = useState<WakeState>("off");
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void>; addEventListener: (e: string, f: () => void) => void }> } };
    if (!nav.wakeLock) {
      setState("unsupported");
      return;
    }
    let lock: { release: () => Promise<void> } | null = null;
    let live = true;
    const ask = async () => {
      try {
        const l = await nav.wakeLock!.request("screen");
        if (!live) return void l.release();
        lock = l;
        setState("on");
        l.addEventListener("release", () => live && setState("off"));
      } catch {
        if (live) setState("off");
      }
    };
    void ask();
    const back = () => document.visibilityState === "visible" && void ask();
    document.addEventListener("visibilitychange", back);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", back);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
  return state;
}

interface Props {
  cards: MeetCard[];
  start: number;
  offlineCards: boolean;
  onClose: () => void;
  notes: {
    add: (input: { name: string; company: string; email: string; phone: string; note: string; tag: EventTag; cardId: string | null }) => AddResult;
    eventName: string;
    setEventName: (v: string) => void;
    waitingCount: number;
    online: boolean;
    sync: () => Promise<void>;
  };
}

export function MeetMode({ cards, start, offlineCards, onClose, notes }: Props) {
  const { t, number, dir } = useI18n();
  const [index, setIndex] = useState(Math.min(Math.max(0, start), Math.max(0, cards.length - 1)));
  const [sheet, setSheet] = useState(false);
  const wake = useWakeLock(true);
  const down = useRef<{ x: number; y: number } | null>(null);
  const card = cards[index];
  const src = useMemo(() => (card ? meetQr(card) : null), [card]);

  const go = useCallback((delta: number) => setIndex((i) => Math.min(cards.length - 1, Math.max(0, i + delta))), [cards.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet) return void (e.key === "Escape" && setSheet(false));
      if (e.key === "Escape") onClose();
      // The arrows follow the reading direction: in Arabic the right arrow goes back.
      if (e.key === "ArrowRight") go(dir === "rtl" ? -1 : 1);
      if (e.key === "ArrowLeft") go(dir === "rtl" ? 1 : -1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, onClose, sheet, dir]);

  // Hold the page still behind the full-screen layer.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!card) return null;

  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || sheet) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // A sideways swipe of a good length moves to the next card (to the left is "next" in a left-to-right language).
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go((dx < 0 ? 1 : -1) * (dir === "rtl" ? -1 : 1));
  };

  return (
    <div className={styles.meet} role="dialog" aria-modal="true" aria-label={t("growth.eventMeetHead")} onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })} onPointerUp={onPointerUp}>
      <div className={styles.top}>
        <button type="button" className={styles.btnLight} onClick={onClose}>{t("growth.eventExit")}</button>
        <span className={styles.chip} role="status">
          <Icon name="eye" size="s" />{wake === "on" ? t("growth.eventWakeOn") : t("growth.eventWakeOff")}
        </span>
        <span className={`${styles.chip} ${notes.waitingCount ? styles.chipWarn : ""}`} role="status" aria-live="polite">
          {notes.online ? t("growth.eventOnline") : t("growth.eventOffline")} - {notes.waitingCount ? t("growth.eventWaiting", { n: number(notes.waitingCount) }) : t("growth.eventAllSent")}
        </span>
        <span className={styles.spacer} />
        <button type="button" className={`${styles.btnLight} ${styles.btnOrange}`} onClick={() => setSheet(true)}>{t("growth.eventQuick")}</button>
      </div>

      <div className={styles.stage}>
        <div className={styles.tile}>
          {src ? <img src={src} alt={t("growth.eventQrAlt", { name: card.name })} draggable={false} /> : <span style={{ color: "#101114" }}>{card.linkText}</span>}
        </div>
        <div>
          <h1 className={styles.name} dir="auto">{card.name}</h1>
          {(card.title || card.company) && <p className={styles.role} dir="auto">{[card.title, card.company].filter(Boolean).join(" - ")}</p>}
        </div>
        {wake === "unsupported" && <p className={styles.hint}>{t("growth.eventWakeNo")}</p>}
        {offlineCards && <p className={styles.hint}>{t("growth.eventOfflineCards")}</p>}
      </div>

      <div className={styles.nav}>
        {cards.length > 1 ? (
          <>
            <button type="button" className={styles.arrow} aria-label={t("growth.eventPrev")} disabled={index === 0} onClick={() => go(-1)}><Icon name="chev" style={{ transform: `scaleX(${dir === "rtl" ? 1 : -1})` }} /></button>
            <div className={styles.dots} role="status" aria-label={t("growth.eventCardOf", { n: number(index + 1), total: number(cards.length) })}>
              {cards.map((c, i) => <span key={c.id} className={`${styles.dot} ${i === index ? styles.dotOn : ""}`} />)}
            </div>
            <button type="button" className={styles.arrow} aria-label={t("growth.eventNext")} disabled={index === cards.length - 1} onClick={() => go(1)}><Icon name="chev" style={{ transform: `scaleX(${dir === "rtl" ? -1 : 1})` }} /></button>
          </>
        ) : null}
      </div>
      {cards.length > 1 && <p className={styles.hint} style={{ textAlign: "center", margin: 0, paddingBlockEnd: 8 }}>{t("growth.eventSwipeHint")}</p>}

      {sheet && (
        <div className={styles.sheet} onClick={(e) => e.target === e.currentTarget && setSheet(false)} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <div className={styles.sheetBody} role="dialog" aria-modal="true" aria-label={t("growth.eventNoteHead")}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>{t("growth.eventNoteHead")}</h2>
              <button type="button" className="btn ghost sm" onClick={() => setSheet(false)}>{t("common.close")}</button>
            </div>
            <QuickNote cardId={card.id} add={notes.add} eventName={notes.eventName} setEventName={notes.setEventName} showEvent={false} onSaved={() => setSheet(false)} />
            {notes.waitingCount > 0 && notes.online && <button type="button" className="btn ghost sm" style={{ marginBlockStart: 10 }} onClick={() => void notes.sync()}>{t("growth.eventSyncNow")}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
