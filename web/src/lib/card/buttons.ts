// The logic behind the Buttons tab: a switch per platform. Pure functions, no screen code.
import type { CardItem, ItemKind } from "@/lib/types";
import { tk, type MessageKey } from "@/lib/i18n";

/** Most buttons one card can have. */
export const MAX_ITEMS = 40;
export const MAX_LABEL = 40;

/** Platform switches, grouped. Custom links are added through "Add any link". */
export const BUTTON_GROUPS: { title: MessageKey; kinds: ItemKind[] }[] = [
  { title: tk("editor.groupContact"), kinds: ["Mobile", "Landline", "WhatsApp", "Email", "SMS", "Location"] },
  { title: tk("editor.groupSocial"), kinds: ["Instagram", "Facebook", "X", "TikTok", "YouTube", "LinkedIn", "Snapchat", "Threads", "Pinterest", "Telegram", "Reddit", "Twitch", "Discord"] },
  { title: tk("editor.groupWork"), kinds: ["GitHub", "Behance", "Dribbble", "Medium", "Meeting", "Calendly", "Website"] },
  { title: tk("editor.groupMusic"), kinds: ["Spotify", "SoundCloud"] },
  { title: tk("editor.groupPayments"), kinds: ["PayPal", "AppStore", "GooglePlay"] },
];

/** Kinds where a second button makes sense (two phones, two emails, two websites). */
export const REPEATABLE: ItemKind[] = ["Mobile", "Email", "Website", "Custom"];

export type Btn = CardItem;

/** An item is shown on the card when it is switched on and has a value. */
export function isShown(i: Pick<Btn, "on" | "value">): boolean {
  return i.on && i.value.trim() !== "";
}

export function indexesOfKind(items: Btn[], kind: ItemKind): number[] {
  const out: number[] = [];
  items.forEach((it, i) => {
    if (it.kind === kind && !brandKeyOf(it)) out.push(i);
  });
  return out;
}

export function brandKeyOf(i: Pick<Btn, "kind" | "icon">): string | null {
  return i.kind === "Custom" && i.icon?.type === "brand" && i.icon.key ? i.icon.key : null;
}

export function canAdd(items: Btn[]): boolean {
  return items.length < MAX_ITEMS;
}

/**
 * Switch a platform on or off.
 * On: re-enable the item that is already there (its value is kept), or add an empty one.
 * Off: hide every item of that platform but keep what was typed, so switching back on restores it.
 */
export function toggleKind(items: Btn[], kind: ItemKind, on: boolean): Btn[] {
  const idx = indexesOfKind(items, kind);
  if (!on) return items.map((it, i) => (idx.includes(i) ? { ...it, on: false } : it));
  if (idx.length > 0) return items.map((it, i) => (i === idx[0] ? { ...it, on: true } : it));
  if (!canAdd(items)) return items;
  return [...items, { kind, value: "", label: "", on: true }];
}

/** Add a second button of the same kind right after the last one. */
export function addAnother(items: Btn[], kind: ItemKind): Btn[] {
  if (!canAdd(items)) return items;
  const idx = indexesOfKind(items, kind);
  const at = idx.length ? idx[idx.length - 1] + 1 : items.length;
  const next = [...items];
  next.splice(at, 0, { kind, value: "", label: "", on: true });
  return next;
}

/** Switch a brand (not in the platform list) on or off. A brand is a custom button with that brand's logo. */
export function toggleBrand(items: Btn[], slug: string, title: string, on: boolean): Btn[] {
  const i = items.findIndex((it) => brandKeyOf(it) === slug);
  if (i >= 0) return items.map((it, k) => (k === i ? { ...it, on } : it));
  if (!on || !canAdd(items)) return items;
  return [...items, { kind: "Custom", value: "", label: title.slice(0, MAX_LABEL), on: true, icon: { type: "brand", key: slug, image_url: null } }];
}

export function setField(items: Btn[], index: number, patch: Partial<Btn>): Btn[] {
  return items.map((it, i) => (i === index ? { ...it, ...patch } : it));
}

export function removeAt(items: Btn[], index: number): Btn[] {
  return items.filter((_, i) => i !== index);
}

/** Move a switched-on button up or down among the switched-on ones (hidden items keep their place). */
export function moveOn(items: Btn[], index: number, dir: -1 | 1): Btn[] {
  let j = index + dir;
  while (j >= 0 && j < items.length && !items[j].on) j += dir;
  if (j < 0 || j >= items.length) return items;
  const next = [...items];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/** What goes to the API: the full list, in order, with only the fields the contract knows. */
export function toApiItems(items: Btn[]): { kind: ItemKind; value: string; label: string; on: boolean; icon: Btn["icon"] }[] {
  return items.map((it) => ({
    kind: it.kind,
    value: it.value.trim(),
    label: it.label.slice(0, MAX_LABEL),
    on: it.on,
    icon: it.icon ?? null,
  }));
}
