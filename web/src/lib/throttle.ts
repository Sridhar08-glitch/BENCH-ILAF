// When the API answers 429 "throttled" it says how long to wait (Retry-After). The wait is remembered here, so every
// button that sends changes can switch itself off until then, and a note with a countdown can be shown.

let blockedUntil = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let snapshot = 0;

function emit(): void {
  snapshot = secondsLeft();
  listeners.forEach((l) => l());
}

function tick(): void {
  timer = null;
  emit();
  if (secondsLeft() > 0) timer = setTimeout(tick, 1000);
}

/** Whole seconds left of the wait, 0 when there is none. */
export function secondsLeft(now: number = Date.now()): number {
  return Math.max(0, Math.ceil((blockedUntil - now) / 1000));
}

/** Retry-After as seconds: a number, or an HTTP date. Anything unusable gives the fallback. */
export function parseRetryAfter(value: string | null | undefined, fallback = 30, now: number = Date.now()): number {
  const v = (value ?? "").trim();
  if (!v) return fallback;
  if (/^\d+$/.test(v)) return Math.min(3600, Math.max(1, Number(v)));
  const at = Date.parse(v);
  if (Number.isNaN(at)) return fallback;
  return Math.min(3600, Math.max(1, Math.ceil((at - now) / 1000)));
}

/** Remember that the API asked us to wait. */
export function noteThrottle(seconds: number): void {
  blockedUntil = Math.max(blockedUntil, Date.now() + seconds * 1000);
  emit();
  if (typeof window !== "undefined" && timer === null) timer = setTimeout(tick, 1000);
}

/** Forget the wait (used by tests). */
export function clearThrottle(): void {
  blockedUntil = 0;
  emit();
}

/** For the React hook in throttle-hook.ts: subscribe to wait changes. */
export function subscribeThrottle(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** For the React hook in throttle-hook.ts: the current number of seconds left. */
export function throttleSnapshot(): number {
  return snapshot;
}
