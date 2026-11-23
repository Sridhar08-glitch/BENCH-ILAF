// IndexedDB side of the offline QR codes, and the one function that wipes everything this device kept (used at sign-out).
// Every call is safe to make anywhere: with no IndexedDB (private mode, old browser) it quietly does nothing.
import { clearNotes } from "@/lib/event/notes";
import { offlineQrChanged, parseOfflineQr, type OfflineQr } from "./offline-qr";

const DB = "bench-offline";
const STORE = "qr";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export async function loadOfflineQrs(): Promise<OfflineQr[]> {
  const db = await open();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => {
        db.close();
        resolve((req.result as unknown[]).map(parseOfflineQr).filter((e): e is OfflineQr => e !== null).sort((a, b) => b.savedAt - a.savedAt));
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  });
}

/** Keeps the owner's QR codes for the offline page. Skips the write when nothing changed. */
export async function saveOfflineQr(entry: OfflineQr): Promise<void> {
  const prev = (await loadOfflineQrs()).find((e) => e.id === entry.id);
  if (!offlineQrChanged(prev, entry)) return;
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    await done(tx);
  } finally {
    db.close();
  }
}

/** Sign-out: delete the saved QR codes, the event notes and the worker's caches. Never throws. */
export async function clearOfflineData(): Promise<void> {
  // Event notes still waiting to be sent are somebody's contacts: they go too.
  try {
    clearNotes(window.localStorage);
  } catch {
    /* no storage */
  }
  try {
    if (typeof indexedDB !== "undefined") {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(DB);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    }
  } catch {
    /* nothing to clear */
  }
  try {
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("bench-")).map((n) => caches.delete(n)));
    }
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR" });
  } catch {
    /* nothing to clear */
  }
}
