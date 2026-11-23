// The support alerts of the staff area: what the server counts, how the badge, the tab title and the sound behave.
import { call } from "@/lib/designs/api";

export type AlertKind = "ticket" | "reply" | "chat";

export interface AlertItem {
  id: string;
  kind: AlertKind;
  label: string;
  requester_name: string;
  subject: string;
  created_at: string;
}

export interface AlertsData {
  new_tickets: number;
  customer_replies: number;
  chats_waiting: number;
  total: number;
  latest: AlertItem[];
}

/** The count is shown up to this number; more reads "99+". */
export const ALERT_CAP = 99;
/** How often the alerts are asked for while the tab is visible and while it is hidden. */
export const ALERT_VISIBLE_MS = 20_000;
export const ALERT_HIDDEN_MS = 60_000;
/** A page change or a reply asks again at once, but not more often than this. */
export const ALERT_MIN_GAP_MS = 3_000;
/** After failures the wait doubles, up to this. */
export const ALERT_MAX_BACKOFF_MS = 5 * 60_000;

export const ALERTS_KEY = ["staff-support-alerts"] as const;
export const SOUND_KEY = "staff:alerts:sound";

export const alertsApi = {
  get: () => call<AlertsData>("staff/support/alerts", { staff: true }),
};

/** What the badge shows: nothing for no news, otherwise the count and whether it passed the cap. */
export function alertBadge(total: number | undefined | null): { value: number; over: boolean } | null {
  const n = Math.floor(Number(total));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > ALERT_CAP ? { value: ALERT_CAP, over: true } : { value: n, over: false };
}

/** The wait before the next ask: 20 s while the tab is visible, 60 s while hidden, doubling after each failure. */
export function alertInterval(hidden: boolean, failures: number): number {
  const base = hidden ? ALERT_HIDDEN_MS : ALERT_VISIBLE_MS;
  const n = Math.max(0, Math.min(Math.floor(failures) || 0, 10));
  return Math.min(base * 2 ** n, ALERT_MAX_BACKOFF_MS);
}

export function alertKindKey(kind: AlertKind): "staff.alerts.kindTicket" | "staff.alerts.kindReply" | "staff.alerts.kindChat" {
  return kind === "chat" ? "staff.alerts.kindChat" : kind === "reply" ? "staff.alerts.kindReply" : "staff.alerts.kindTicket";
}

/** Where an alert leads: a request opens its own page, a live chat opens the chat console. */
export function alertHref(item: Pick<AlertItem, "kind" | "id">): string {
  return item.kind === "chat" ? "/staff/support/chats" : `/staff/support/${item.id}`;
}

export function onSupportPage(pathname: string): boolean {
  return pathname === "/staff/support" || pathname.startsWith("/staff/support/");
}

const PREFIX = /^\(\d+\+?\) /;

export function stripCountPrefix(title: string): string {
  return title.replace(PREFIX, "");
}

/** The tab shows the count in front of the title while there is news and the person is not looking at the Support pages. */
export function titleWithCount(base: string, total: number, hidden: boolean, onSupport: boolean): string {
  const badge = alertBadge(total);
  const clean = stripCountPrefix(base);
  if (!badge || (!hidden && onSupport)) return clean;
  return `(${badge.value}${badge.over ? "+" : ""}) ${clean}`;
}

/** A chat is newly waiting: the count went up since the last answer. The first answer never counts. */
export function chatsIncreased(previous: number | undefined, next: number | undefined): boolean {
  return previous !== undefined && next !== undefined && next > previous;
}

// ---- the sound (off until the person turns it on, remembered on this device)
export function readSoundPref(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSoundPref(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    /* storage is blocked: the choice lasts until the page closes */
  }
}

let audio: AudioContext | null = null;

function context(): AudioContext | null {
  if (audio) return audio;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audio = new Ctor();
    return audio;
  } catch {
    return null;
  }
}

/** Called from the click that turns the sound on: a browser lets sound start only after a click or key press. */
export function primeSound(): void {
  const ctx = context();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
}

/** A short soft two-note beep made on the spot. A browser that still refuses sound is ignored. */
export function playBeep(): void {
  try {
    const ctx = context();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
      if (ctx.state === "suspended") return;
    }
    const start = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = start + i * 0.16;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.16);
    });
  } catch {
    /* sound is not available: the bell still counts */
  }
}
