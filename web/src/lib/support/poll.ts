// How often the chat asks the server for news: quickly while the person looks at it, slowly while the tab is hidden,
// backing off after errors, and not at all once nothing has happened for a long time.

export const FOCUSED_MS = 2000;
export const HIDDEN_MS = 8000;
export const MAX_BACKOFF_MS = 30_000;
/** After this long without any message in either direction the polling stops until the person resumes. */
export const IDLE_STOP_MS = 15 * 60_000;

export interface PollState {
  /** True while the chat is on screen and the tab is in front. */
  focused: boolean;
  /** Failed requests in a row. */
  failures: number;
}

/** The wait before the next request. */
export function pollDelay({ focused, failures }: PollState): number {
  const base = focused ? FOCUSED_MS : HIDDEN_MS;
  if (failures <= 0) return base;
  return Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(failures, 6));
}

/** True when polling should stop: no activity for IDLE_STOP_MS. */
export function isIdle(lastActivityAt: number, now: number): boolean {
  return now - lastActivityAt >= IDLE_STOP_MS;
}

/** The newest message id of a list (the `since` cursor for the next request). */
export function nextCursor(current: number, messages: { id: number }[]): number {
  return messages.reduce((max, m) => (m.id > max ? m.id : max), current);
}

/** Add new messages to a list without repeating one that is already there (a slow answer can arrive twice). */
export function mergeMessages<T extends { id: number }>(list: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return list;
  const seen = new Set(list.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  return fresh.length === 0 ? list : [...list, ...fresh].sort((a, b) => a.id - b.id);
}

/** Typing notices are sent at most this often. */
export const TYPING_EVERY_MS = 4000;
export function shouldSendTyping(lastSentAt: number, now: number): boolean {
  return now - lastSentAt >= TYPING_EVERY_MS;
}
