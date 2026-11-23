// Hands the editor's unsaved card (or brand) drawing to the "Open preview in a new tab" page, and keeps it live.
// The editor writes the current draft under a key; the preview tab reads it on load and listens for new ones
// (a BroadcastChannel message, with the storage event as a fallback). Nothing here touches the server.

const CHANNEL = "bench-preview";
const PREFIX = "bench-preview:";
/** A stored draft older than this is ignored, so an old editing session never shows up by itself. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface Stored<T> {
  at: number;
  data: T;
}

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}

/** Remember the draft and tell any open preview tab. Quietly does nothing when storage is not available. */
export function publishDraft<T>(key: string, data: T): void {
  const body: Stored<T> = { at: Date.now(), data };
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(body));
  } catch {
    /* storage full or blocked: the preview tab then falls back to the channel or the saved data */
  }
  const ch = channel();
  if (ch) {
    try {
      ch.postMessage({ key, body });
    } catch {
      /* not cloneable: ignore */
    }
    ch.close();
  }
}

/** The last draft published under the key, if it is recent. */
export function readDraft<T>(key: string, now: number = Date.now()): T | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const body = JSON.parse(raw) as Stored<T>;
    return body && typeof body.at === "number" && now - body.at < MAX_AGE_MS ? body.data : null;
  } catch {
    return null;
  }
}

/** Forget the draft (the editor was closed). */
export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Call `on` with every new draft published under the key. Returns the function that stops listening. */
export function subscribeDraft<T>(key: string, on: (data: T) => void): () => void {
  const ch = channel();
  const onMessage = (e: MessageEvent) => {
    const m = e.data as { key?: string; body?: Stored<T> } | null;
    if (m && m.key === key && m.body) on(m.body.data);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== PREFIX + key || !e.newValue) return;
    try {
      on((JSON.parse(e.newValue) as Stored<T>).data);
    } catch {
      /* ignore */
    }
  };
  ch?.addEventListener("message", onMessage);
  window.addEventListener("storage", onStorage);
  return () => {
    ch?.removeEventListener("message", onMessage);
    ch?.close();
    window.removeEventListener("storage", onStorage);
  };
}

/** The address of the preview page for a card id, or "brand" for the company brand. */
export function previewHref(id: string): string {
  return `/app/preview/${encodeURIComponent(id)}`;
}
