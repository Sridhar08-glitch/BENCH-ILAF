// A contact held inside a QR code: a small vCard 3.0 that a phone camera reads with no internet at all.
// Only the essentials go in (name, title, company, phone, email, website). Address and note can be asked
// for, and are the first things cut when the code would get too dense to scan from a distance.
import { hrefFor } from "./href";
import { splitContactName, vcardProp, vq } from "./vcard";
import { runtimeT, tk, type TFunction } from "@/lib/i18n";

export interface QrContactSource {
  name: string;
  title: string;
  company: string;
  address: string;
  /** Free note, only used when asked for. */
  note?: string;
  items: { kind: string; value: string; on?: boolean }[];
}

export interface QrContactOptions {
  address?: boolean;
  note?: boolean;
}

/** Up to this many bytes a code stays easy to scan from a screen or a small print. */
export const QR_COMFORTABLE_BYTES = 250;
/** Above this the code is cut down until it fits; the contact is never cut below name, phone and email. */
export const QR_TRIM_TARGET_BYTES = 320;
/** The most that will ever be encoded. */
export const QR_MAX_BYTES = 800;

export type QrFieldKey = "note" | "address" | "website" | "title" | "company";

export interface QrContact {
  text: string;
  bytes: number;
  /** Fields that were left out to keep the code small, in the order they were cut. */
  trimmed: QrFieldKey[];
  /** ok: easy to scan. dense: scans, but needs a larger print or a steady phone. */
  level: "ok" | "dense";
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function first(items: QrContactSource["items"], kinds: string[]): string {
  for (const k of kinds) {
    const it = items.find((x) => x.kind === k && x.on !== false && x.value.trim());
    if (it) return it.value.trim();
  }
  return "";
}

/** Digits with a leading plus kept (00 counts as plus). */
export function phoneOf(raw: string): string {
  let v = raw.trim().replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if (v.startsWith("00")) v = `+${v.slice(2)}`;
  return v;
}

/** The vCard text for the fields that are still switched on. */
function render(c: QrContactSource, keep: Record<QrFieldKey, boolean>): string {
  const [family, given] = splitContactName(c.name);
  const phoneRaw = first(c.items, ["Mobile", "Landline", "WhatsApp"]);
  const phone = phoneOf(phoneRaw);
  const email = first(c.items, ["Email"]).replace(/^mailto:/i, "");
  const web = hrefFor("Website", first(c.items, ["Website"]));
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `${vcardProp("N", c.name)}:${vq(family)};${vq(given)};;;`, `${vcardProp("FN", c.name)}:${vq(c.name.trim())}`];
  if (keep.company && c.company.trim()) lines.push(`ORG:${vq(c.company.trim())}`);
  if (keep.title && c.title.trim()) lines.push(`TITLE:${vq(c.title.trim())}`);
  if (phone) lines.push(`TEL;TYPE=CELL:${phone}`);
  if (email) lines.push(`EMAIL:${email}`);
  if (keep.website && web && /^https?:/i.test(web)) lines.push(`URL:${web}`);
  if (keep.address && c.address.trim()) lines.push(`ADR;TYPE=WORK:;;${vq(c.address.trim())};;;;`);
  if (keep.note && c.note?.trim()) lines.push(`NOTE:${vq(c.note.trim())}`);
  lines.push("END:VCARD");
  return lines.join("\n");
}

/** Build the contact for a QR code, cutting the least important fields until it is small enough. */
export function buildQrContact(c: QrContactSource, opts: QrContactOptions = {}): QrContact {
  const keep: Record<QrFieldKey, boolean> = { note: !!opts.note, address: !!opts.address, website: true, title: true, company: true };
  const trimmed: QrFieldKey[] = [];
  let text = render(c, keep);
  for (const k of ["note", "address", "website", "title", "company"] as QrFieldKey[]) {
    if (utf8Bytes(text) <= QR_TRIM_TARGET_BYTES) break;
    if (!keep[k]) continue;
    keep[k] = false;
    trimmed.push(k);
    text = render(c, keep);
  }
  const bytes = utf8Bytes(text);
  return { text, bytes, trimmed, level: bytes <= QR_COMFORTABLE_BYTES ? "ok" : "dense" };
}

/** A sentence about the size, or null when the code is comfortable. */
export function qrSizeWarning(q: QrContact, t: TFunction = runtimeT): string | null {
  const fields = q.trimmed.map((k) => fieldWord(k, t));
  const cut = fields.length ? ` ${t("tools.qrCutSmall", { fields: fields.join(t("common.listSeparator")) })}` : "";
  if (q.bytes > QR_MAX_BYTES) return t("tools.qrTooLong");
  if (q.level === "dense") return `${t("tools.qrDense", { bytes: q.bytes })}${cut}`;
  return fields.length ? t("tools.qrCutEasy", { fields: fields.join(t("common.listSeparator")) }) : null;
}

function fieldWord(k: QrFieldKey, t: TFunction): string {
  return t(k === "note" ? tk("tools.qrFieldNote") : k === "address" ? tk("tools.qrFieldAddress") : k === "website" ? tk("tools.qrFieldWebsite") : k === "title" ? tk("tools.qrFieldTitle") : tk("tools.qrFieldCompany"));
}
