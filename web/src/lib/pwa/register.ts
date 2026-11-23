// Registering the service worker and keeping it up to date. Browser only.

/** The worker is for the signed-in app on a secure page, and only in a production build (a dev server must never be cached). */
export function canRegister(env: { production: boolean; protocol: string; hostname: string; hasApi: boolean }): boolean {
  if (!env.production || !env.hasApi) return false;
  return env.protocol === "https:" || env.hostname === "localhost" || env.hostname === "127.0.0.1";
}

export interface Updater {
  /** Tell the waiting worker to take over; the page reloads when it has. */
  apply: () => void;
}

/** Registers /sw.js. `onUpdate` is called when a newer version is installed and waiting. Returns false when it was not registered. */
export async function registerServiceWorker(onUpdate: (u: Updater) => void): Promise<boolean> {
  const ok = canRegister({
    production: process.env.NODE_ENV === "production",
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    hasApi: "serviceWorker" in navigator,
  });
  if (!ok) return false;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    const offer = (worker: ServiceWorker | null) => {
      if (worker && navigator.serviceWorker.controller) onUpdate({ apply: () => worker.postMessage({ type: "SKIP_WAITING" }) });
    };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const next = reg.installing;
      next?.addEventListener("statechange", () => {
        if (next.state === "installed") offer(next);
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
    // Look for a new version now and then while the app stays open.
    window.setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);
    return true;
  } catch {
    return false;
  }
}
