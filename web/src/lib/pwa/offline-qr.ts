// The owner's own QR codes kept on the device so "My QR" opens with no connection. Pure: shaping and validating what is stored;
// the IndexedDB part is in store.ts.
import { normaliseStyle, type QrStyle } from "@/lib/qr/style";

export interface OfflineQr {
  /** The card's id. */
  id: string;
  name: string;
  title: string;
  company: string;
  /** The card's public address, shown under the code. */
  publicUrl: string;
  /** What the "card link" code holds. */
  linkText: string;
  /** What the "contact inside the code" holds (a vCard), or "" when it did not fit. */
  contactText: string;
  /** The saved look and, when it uses a picture in the middle, that picture as a data address. */
  style: QrStyle;
  logoHref: string | null;
  savedAt: number;
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** A stored record, checked; null when it is not one of ours. */
export function parseOfflineQr(raw: unknown): OfflineQr | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id, 80);
  const linkText = text(r.linkText, 2000);
  if (!id || !linkText) return null;
  const logo = typeof r.logoHref === "string" && r.logoHref.startsWith("data:image/") && r.logoHref.length < 400_000 ? r.logoHref : null;
  return {
    id, name: text(r.name, 120), title: text(r.title, 120), company: text(r.company, 120), publicUrl: text(r.publicUrl, 500),
    linkText, contactText: text(r.contactText, 4000), style: normaliseStyle(r.style), logoHref: logo,
    savedAt: typeof r.savedAt === "number" && Number.isFinite(r.savedAt) ? r.savedAt : 0,
  };
}

/** Same card replaces its older entry; newest first. */
export function upsertOfflineQr(list: OfflineQr[], entry: OfflineQr): OfflineQr[] {
  return [entry, ...list.filter((e) => e.id !== entry.id)].sort((a, b) => b.savedAt - a.savedAt);
}

/** True when saving `next` would change what is stored (so an unchanged code is not rewritten on every visit). */
export function offlineQrChanged(prev: OfflineQr | undefined, next: OfflineQr): boolean {
  if (!prev) return true;
  return JSON.stringify({ ...prev, savedAt: 0 }) !== JSON.stringify({ ...next, savedAt: 0 });
}
