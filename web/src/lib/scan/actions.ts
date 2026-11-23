// What can be done with the fields read from a paper card: a contact file, a lead, or filling the user's own card.
import { vq } from "@/lib/card/vcard";
import type { Btn } from "@/lib/card/buttons";
import type { ItemKind } from "@/lib/types";
import { tk, type MessageKey, type TFunction } from "@/lib/i18n";

/** The reviewed fields, as the person left them on the review screen. */
export interface ScanFields {
  name: string;
  title: string;
  company: string;
  phones: string[];
  emails: string[];
  websites: string[];
  address: string;
  /** Social profile links or handles, one per entry. */
  social: string[];
}

export const EMPTY_FIELDS: ScanFields = { name: "", title: "", company: "", phones: [""], emails: [""], websites: [""], address: "", social: [] };

const filled = (list: string[]) => list.map((s) => s.trim()).filter(Boolean);

/** A vCard 3.0 contact for the phone's address book. Returns "" when there is no name to save under. */
export function scanVcard(f: ScanFields, labels: { note?: string; social?: string } = {}): string {
  const name = f.name.trim();
  if (!name) return "";
  const parts = name.split(/\s+/);
  const given = parts.shift() ?? "";
  const family = parts.join(" ");
  const L = ["BEGIN:VCARD", "VERSION:3.0", `N:${vq(family)};${vq(given)};;;`, `FN:${vq(name)}`];
  if (f.company.trim()) L.push(`ORG:${vq(f.company.trim())}`);
  if (f.title.trim()) L.push(`TITLE:${vq(f.title.trim())}`);
  filled(f.phones).forEach((p, i) => L.push(`TEL;TYPE=${i === 0 ? "CELL" : "WORK,VOICE"}:${p.replace(/[^\d+]/g, "")}`));
  filled(f.emails).forEach((e) => L.push(`EMAIL;TYPE=INTERNET:${e}`));
  filled(f.websites).forEach((w) => L.push(`URL:${/^https?:\/\//i.test(w) ? w : `https://${w}`}`));
  if (f.address.trim()) L.push(`ADR;TYPE=WORK:;;${vq(f.address.trim().replace(/\s*\n\s*/g, ", "))};;;;`);
  filled(f.social).forEach((s, i) => {
    if (/^https?:\/\//i.test(s)) L.push(`item${i + 1}.URL:${s}`, `item${i + 1}.X-ABLabel:${vq(labels.social ?? "Social")}`);
  });
  if (labels.note) L.push(`NOTE:${vq(labels.note)}`);
  L.push("END:VCARD");
  return `${L.join("\r\n")}\r\n`;
}

/** The body of a lead made from a scan: what the leads inbox stores. */
export function scanLead(f: ScanFields, t: TFunction): { name: string; email?: string; phone?: string; company?: string; note?: string } {
  const notes = [
    f.title.trim() && t("tools.leadTitle", { value: f.title.trim() }),
    filled(f.websites)[0] && t("tools.leadWebsite", { value: filled(f.websites)[0] }),
    f.address.trim() && t("tools.leadAddress", { value: f.address.trim() }),
    filled(f.phones)[1] && t("tools.leadOtherPhone", { value: filled(f.phones)[1] }),
    t("tools.leadScanned"),
  ].filter(Boolean);
  return {
    name: f.name.trim(),
    email: filled(f.emails)[0] || undefined,
    phone: filled(f.phones)[0] || undefined,
    company: f.company.trim() || undefined,
    note: notes.join("\n").slice(0, 2000),
  };
}

export interface FillChange {
  field: "name" | "title" | "company" | "phone" | "email";
  from: string;
  to: string;
}

/** A card as far as filling is concerned. */
export interface FillTarget {
  name: string;
  title: string;
  company: string;
  items: Btn[];
}

function firstValue(items: Btn[], kinds: ItemKind[]): string {
  for (const k of kinds) {
    const it = items.find((i) => i.kind === k && i.value.trim());
    if (it) return it.value.trim();
  }
  return "";
}

/** What "Fill my card" would change: only fields that the scan has a value for and that differ. */
export function fillChanges(card: FillTarget, f: ScanFields): FillChange[] {
  const out: FillChange[] = [];
  const add = (field: FillChange["field"], from: string, to: string) => {
    if (to.trim() && to.trim() !== from.trim()) out.push({ field, from, to: to.trim() });
  };
  add("name", card.name, f.name);
  add("title", card.title, f.title);
  add("company", card.company, f.company);
  add("phone", firstValue(card.items, ["Mobile"]), filled(f.phones)[0] ?? "");
  add("email", firstValue(card.items, ["Email"]), filled(f.emails)[0] ?? "");
  return out;
}

/** The text of the label of each field that "Fill my card" can change. */
export const FILL_LABELS: Record<FillChange["field"], MessageKey> = {
  name: tk("tools.fillName"), title: tk("tools.fillTitle"), company: tk("tools.fillCompany"), phone: tk("tools.fillPhone"), email: tk("tools.fillEmail"),
};

/** The card after the accepted changes: text fields set, the first Mobile and Email buttons updated (or added) and switched on. */
export function applyFill(card: FillTarget, changes: FillChange[]): { name: string; title: string; company: string; items: Btn[] } {
  const next = { name: card.name, title: card.title, company: card.company, items: card.items.map((i) => ({ ...i })) };
  const setItem = (kind: ItemKind, value: string) => {
    const at = next.items.findIndex((i) => i.kind === kind);
    if (at >= 0) next.items[at] = { ...next.items[at], value, on: true };
    else next.items.push({ kind, value, label: "", on: true });
  };
  for (const c of changes) {
    if (c.field === "name") next.name = c.to;
    else if (c.field === "title") next.title = c.to;
    else if (c.field === "company") next.company = c.to;
    else if (c.field === "phone") setItem("Mobile", c.to);
    else if (c.field === "email") setItem("Email", c.to);
  }
  return next;
}
