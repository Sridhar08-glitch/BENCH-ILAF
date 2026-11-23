// Contact-file (vCard) logic: what is saved to a visitor's phone.
// The same field list feeds the phone preview and the contact-file text, so they never differ.
import { isMeetingForm } from "./meeting";
import { SOCIAL_KINDS, WEB_KINDS, digitsOf, httpUrl, platformOf } from "./catalogue";
import type { CardItem, VcardOptions } from "@/lib/types";

export interface VcField {
  t: "tel" | "email" | "url" | "adr";
  /** Label shown in the preview and written as the vCard label. */
  l: string;
  v: string;
  /** vCard TYPE for phone numbers. */
  type?: string;
}

export interface VcSource {
  name: string;
  title: string;
  company: string;
  address: string;
  items: Pick<CardItem, "kind" | "value" | "label" | "on">[];
  vc: VcardOptions;
  /** Full address of the card page, added as "my card". */
  cardUrl: string;
}

/** Escape a value for a vCard text field. */
export function vq(s: string): string {
  return String(s).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** Words that belong to the family name that follows them ("Al Thani", "آل ثاني"), never to the given names. */
const FAMILY_PREFIXES = new Set(["al", "el", "آل", "ال"]);

/**
 * Split a full name into [family, given] like the server does: the last word is the family name (with a prefix
 * such as "Al" or "آل" before it when a given name stays in front); a single word is kept whole as the given name.
 * Names are never transliterated or reordered.
 */
export function splitContactName(full: string): [string, string] {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return ["", parts[0] ?? ""];
  const n = parts.length >= 3 && FAMILY_PREFIXES.has(parts[parts.length - 2].toLowerCase()) ? 2 : 1;
  return [parts.slice(-n).join(" "), parts.slice(0, -n).join(" ")];
}

/** The property name with `;CHARSET=UTF-8` when the value is outside the Latin alphabet (Arabic, ...), as the server writes it. */
export function vcardProp(name: string, value: string): string {
  const latin = Array.from(value).every((ch) => ch.charCodeAt(0) < 0x250 || (ch.charCodeAt(0) >= 0x2000 && ch.charCodeAt(0) <= 0x20cf));
  if (latin) return name;
  const [head, ...rest] = name.split(";");
  return [head, "CHARSET=UTF-8", ...rest].join(";");
}

/** Reverse of vq, used when reading a vCard back. */
export function unvq(s: string): string {
  return s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

/** The fields to save, honouring the owner's switches. WhatsApp is a phone number and never doubles up. */
export function vcardFields(c: VcSource): VcField[] {
  const o = c.vc;
  const f: VcField[] = [];
  const seen = new Set<string>();
  c.items
    .filter((x) => x.on && x.value.trim())
    .forEach((x) => {
      const k = x.kind;
      const v = x.value.trim();
      if (k === "Meeting" && isMeetingForm(v)) return;
      if ((k === "Mobile" || k === "Landline" || k === "WhatsApp") && o.phones) {
        const dg = digitsOf(v);
        if (k === "WhatsApp" && seen.has(dg)) return;
        seen.add(dg);
        f.push({
          t: "tel",
          type: k === "Landline" ? "WORK,VOICE" : "CELL",
          l: k === "Landline" ? "work" : k === "WhatsApp" ? "WhatsApp" : "mobile",
          v,
        });
      } else if (k === "Email" && o.emails) {
        f.push({ t: "email", l: "work", v });
      } else if (SOCIAL_KINDS.has(k) && o.social) {
        f.push({ t: "url", l: platformOf(k).name, v: httpUrl(v) });
      } else if (WEB_KINDS.has(k) && o.urls) {
        f.push({ t: "url", l: k === "Website" ? "website" : k === "Custom" ? x.label || "link" : platformOf(k).name, v: httpUrl(v) });
      }
    });
  if (o.addr && c.address.trim()) f.push({ t: "adr", l: "work", v: c.address.trim() });
  f.push({ t: "url", l: "my card", v: c.cardUrl });
  return f;
}

/** The vCard 3.0 text (preview only; the real file comes from the server). */
export function buildVcard(c: VcSource): string {
  const o = c.vc;
  const [last, first] = splitContactName(c.name);
  const L = ["BEGIN:VCARD", "VERSION:3.0", `${vcardProp("N", c.name)}:${vq(last)};${vq(first)};;;`, `${vcardProp("FN", c.name)}:${vq(c.name)}`];
  let n = 0;
  if (o.company && c.company) L.push(`${vcardProp("ORG", c.company)}:${vq(c.company)}`);
  if (c.title) L.push(`${vcardProp("TITLE", c.title)}:${vq(c.title)}`);
  vcardFields(c).forEach((f) => {
    if (f.t === "tel") L.push(`TEL;TYPE=${f.type}:${f.v}`);
    else if (f.t === "email") L.push(`EMAIL;TYPE=INTERNET,WORK:${f.v}`);
    else if (f.t === "url") {
      n += 1;
      L.push(`item${n}.URL:${f.v}`, `item${n}.X-ABLabel:${vq(f.l)}`);
    } else L.push(`ADR;TYPE=WORK:;;${vq(f.v)};;;;`);
  });
  if (o.photo) L.push("PHOTO;ENCODING=b;TYPE=JPEG:<256 px square photo, sent as base64>");
  if (o.note) L.push(`NOTE:${vq(o.note)}`);
  L.push("END:VCARD");
  return L.join("\n");
}

// ---- the "New Contact" preview

export interface ContactPreview {
  name: string;
  /** Job title and company, joined for the subtitle. */
  subtitle: string;
  hasPhoto: boolean;
  rows: { label: string; value: string }[];
  note: string;
}

/** Preview of what the phone will show, built from the card and the owner's switches. */
export function previewFromCard(c: VcSource): ContactPreview {
  const rows = vcardFields(c).map((x) => ({ label: x.l, value: x.t === "adr" ? x.v : x.v.replace(/^https?:\/\//, "") }));
  return {
    name: c.name,
    subtitle: [c.title, c.vc.company ? c.company : ""].filter(Boolean).join(" - "),
    hasPhoto: c.vc.photo,
    rows,
    note: c.vc.note,
  };
}

/** Preview of what the phone will show, read back from a real vCard file. */
export function parseVcard(text: string): ContactPreview {
  // Undo line folding: a line that starts with a space or tab continues the one before.
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  let name = "";
  let title = "";
  let org = "";
  let note = "";
  let hasPhoto = false;
  const rows: { label: string; value: string }[] = [];
  const itemLabels = new Map<string, string>();
  const itemUrls: [string, string][] = [];

  for (const raw of lines) {
    const line = raw.trim();
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const head = line.slice(0, idx);
    const val = line.slice(idx + 1);
    const dot = head.indexOf(".");
    const group = dot > -1 ? head.slice(0, dot) : "";
    const propFull = dot > -1 ? head.slice(dot + 1) : head;
    const [propName, ...params] = propFull.split(";");
    const prop = propName.toUpperCase();
    const paramText = params.join(";").toUpperCase();

    if (prop === "FN") name = unvq(val);
    else if (prop === "TITLE") title = unvq(val);
    else if (prop === "ORG") org = unvq(val.split(";")[0]);
    else if (prop === "NOTE") note = unvq(val);
    else if (prop === "PHOTO") hasPhoto = true;
    else if (prop === "TEL") {
      const label = paramText.includes("CELL") ? "mobile" : paramText.includes("WORK") ? "work" : paramText.includes("HOME") ? "home" : "phone";
      rows.push({ label, value: unvq(val) });
    } else if (prop === "EMAIL") rows.push({ label: paramText.includes("HOME") ? "home" : "work", value: unvq(val) });
    else if (prop === "ADR") rows.push({ label: "work", value: val.split(";").map(unvq).filter(Boolean).join(", ") });
    else if (prop === "URL") {
      if (group) itemUrls.push([group, val]);
      else rows.push({ label: "url", value: val.replace(/^https?:\/\//, "") });
    } else if (prop === "X-ABLABEL" && group) itemLabels.set(group, unvq(val));
  }
  itemUrls.forEach(([g, v]) => rows.push({ label: itemLabels.get(g) || "url", value: v.replace(/^https?:\/\//, "") }));
  return { name, subtitle: [title, org].filter(Boolean).join(" - "), hasPhoto, rows, note };
}
