// Browser side of Web Push: ask permission, subscribe through the service worker, and give the subscription to the API.
// Pure helpers first (tested), then the few functions that need the browser.

/** The server's VAPID public key (unpadded base64url) as the bytes `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState = "unsupported" | "denied" | "off" | "on";

/** What the opt-in button should show, from the browser's permission and whether this browser is subscribed. */
export function pushState(supported: boolean, permission: NotificationPermission | "default", subscribed: boolean): PushState {
  if (!supported) return "unsupported";
  if (permission === "denied") return "denied";
  return subscribed && permission === "granted" ? "on" : "off";
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

/** Ask for permission (a click is needed) and subscribe. Returns the subscription, or null when the person said no. */
export async function enablePush(publicKey: string): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;
  const reg = await registration();
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
}

/** Stop this browser's subscription. Returns its endpoint (so the server can forget it) or null. */
export async function disablePush(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

/** The browser's time zone name ("Asia/Qatar"), or an empty string when it cannot be read. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}
