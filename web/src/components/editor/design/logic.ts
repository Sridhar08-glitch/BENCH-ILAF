// Pure helpers of the step-by-step design picker: the steps, filtering and searching the numbered lists,
// paging, and the choice of a random item. No React here so every rule can be tested on its own.
import { BELOW_COUNT, FACE_COUNT, INTRO_COUNT, belowInfo, faceInfo, introInfo } from "@/lib/library";
import { APP_NAME } from "@/lib/config";
import { tk, type MessageKey, type TFunction } from "@/lib/i18n";

export const STEPS = [
  { key: "face", label: tk("editor.stepFace") },
  { key: "colour", label: tk("editor.stepColours") },
  { key: "text", label: tk("editor.stepText") },
  { key: "below", label: tk("editor.stepBelow") },
  { key: "anim", label: tk("editor.stepAnim") },
  { key: "finish", label: tk("editor.stepFinish") },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

export const TAGS = ["corporate", "creative", "luxury", "minimal", "bold", "tech", "playful"] as const;
export type Tag = (typeof TAGS)[number];

/** Faces 1 to 400 are Pack 1; 401 to 500 are Design Pack 2 (added later, shown with a "new" mark and switchable by the product team). */
export const PACK1_COUNT = 400;
export const PACKS = [1, 2] as const;
export type Pack = (typeof PACKS)[number];
export const packOf = (face: number): Pack => (face > PACK1_COUNT ? 2 : 1);
export const PACK_LABELS: Record<Pack, MessageKey> = { 1: tk("editor.pack1"), 2: tk("editor.pack2") };

/** The faces the picker offers: without Pack 2 when its switch is off for this company. */
export function offeredFaces(pack2: boolean): Item[] {
  return pack2 ? faceItems() : faceItems().filter((it) => packOf(it.n) === 1);
}

/** The message that names each style tag. */
export const TAG_LABELS: Record<Tag, MessageKey> = {
  corporate: tk("editor.tagCorporate"), creative: tk("editor.tagCreative"), luxury: tk("editor.tagLuxury"), minimal: tk("editor.tagMinimal"),
  bold: tk("editor.tagBold"), tech: tk("editor.tagTech"), playful: tk("editor.tagPlayful"),
};

/** A style tag in the language of `t` (a tag this list does not know is shown as it is). */
export const tagLabel = (tag: string, t: TFunction): string => (tag in TAG_LABELS ? t(TAG_LABELS[tag as Tag]) : tag);

const PALETTE_LABELS: Record<string, MessageKey> = {
  Midnight: tk("editor.palMidnight"), Ivory: tk("editor.palIvory"), Forest: tk("editor.palForest"), Sunset: tk("editor.palSunset"),
  "Navy and gold": tk("editor.palNavyGold"), Rose: tk("editor.palRose"), Graphite: tk("editor.palGraphite"), Signal: tk("editor.palSignal"),
  Sky: tk("editor.palSky"), Coral: tk("editor.palCoral"), Mint: tk("editor.palMint"), Lavender: tk("editor.palLavender"),
  Mustard: tk("editor.palMustard"), Burgundy: tk("editor.palBurgundy"), Teal: tk("editor.palTeal"), Steel: tk("editor.palSteel"),
  Cocoa: tk("editor.palCocoa"), Olive: tk("editor.palOlive"), Ink: tk("editor.palInk"), Peach: tk("editor.palPeach"),
  Ocean: tk("editor.palOcean"), Candy: tk("editor.palCandy"), Cyber: tk("editor.palCyber"),
};

/** The name of a colourway in the language of `t`. The product's own colourway carries the product name. */
export function paletteLabel(name: string, t: TFunction): string {
  if (name === "BENCH") return APP_NAME;
  const key = PALETTE_LABELS[name];
  return key ? t(key) : name;
}

/** How many items a list shows before "Show more". */
export const PAGE_SIZE = 24;

export interface Item {
  n: number;
  name: string;
  tags: string[];
  description: string;
}

/** Position in the flow, and how far the owner has got (steps up to `reached` can be opened from the header). */
export interface StepState {
  step: number;
  reached: number;
}

export const firstStep = (): StepState => ({ step: 0, reached: 0 });

const last = STEPS.length - 1;

export function nextStep(s: StepState): StepState {
  const step = Math.min(s.step + 1, last);
  return { step, reached: Math.max(s.reached, step) };
}

export function backStep(s: StepState): StepState {
  return { ...s, step: Math.max(s.step - 1, 0) };
}

/** Jump to a step that has been reached already. Other jumps are ignored. */
export function goToStep(s: StepState, i: number): StepState {
  return Number.isInteger(i) && i >= 0 && i <= s.reached ? { ...s, step: i } : s;
}

/** A step shows a tick once the owner has moved past it. */
export const isDone = (s: StepState, i: number) => i < s.reached;

function build(count: number, info: (n: number) => Item): Item[] {
  return Array.from({ length: count }, (_, i) => info(i + 1));
}

let faces: Item[] | null = null;
let belows: Item[] | null = null;
let intros: Item[] | null = null;

/** The 500 faces (built once). */
export function faceItems(): Item[] {
  return (faces ??= build(FACE_COUNT, (n) => {
    const f = faceInfo(n);
    return { n, name: f.name, tags: f.tags, description: f.tags.join(", ") };
  }));
}

export function belowItems(): Item[] {
  return (belows ??= build(BELOW_COUNT, (n) => {
    const b = belowInfo(n);
    return { n, name: b.name, tags: [], description: b.description };
  }));
}

/** The openings 1..400 (0, "no animation", is offered separately). */
export function introItems(): Item[] {
  return (intros ??= build(INTRO_COUNT, (n) => ({ n, name: introInfo(n).name, tags: [], description: "" })));
}

/** "007" for 7. */
export const pad = (n: number) => String(n).padStart(3, "0");

/** Words typed in the search box, lower case, without empty parts. */
function words(q: string): string[] {
  return q.toLowerCase().split(/[\s,]+/).filter(Boolean);
}

/**
 * Items that match every word typed: a word is found in the name, the description or the tags, or it is
 * the item's number ("12", "012" or "#12"). An optional tag keeps only items that carry it, an optional pack only
 * the faces of that pack. `extra` adds more searchable words per item (the tags in the viewer's language).
 */
export function filterItems(list: Item[], query: string, tag?: string | null, extra?: (it: Item) => string, pack?: Pack | null): Item[] {
  const ws = words(query);
  return list.filter((it) => {
    if (tag && !it.tags.includes(tag)) return false;
    if (pack && packOf(it.n) !== pack) return false;
    const hay = `${it.name} ${it.description} ${it.tags.join(" ")} ${extra ? extra(it) : ""}`.toLowerCase();
    return ws.every((w) => {
      const num = w.replace(/^#/, "");
      return hay.includes(w) || (/^\d+$/.test(num) && Number(num) === it.n);
    });
  });
}

/** The first `pages` pages of a list, and whether more remain. */
export function pageOf<T>(list: T[], pages: number, size = PAGE_SIZE): { shown: T[]; more: number } {
  const take = Math.max(1, Math.floor(pages)) * size;
  return { shown: list.slice(0, take), more: Math.max(0, list.length - take) };
}

/** The page count needed so that the item with this number is on screen (so a chosen item is visible). */
export function pagesToShow(list: Item[], n: number, size = PAGE_SIZE): number {
  const i = list.findIndex((it) => it.n === n);
  return i < 0 ? 1 : Math.floor(i / size) + 1;
}

/** A whole number from min to max, using `rand` (0 up to but not including 1). */
export function randomBetween(min: number, max: number, rand: () => number = Math.random): number {
  return min + Math.min(max - min, Math.floor(rand() * (max - min + 1)));
}
