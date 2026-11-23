// A person with several cards: which one is the default, how the list is ordered and what a card is called in the list.
import type { Card } from "@/lib/types";

/** The cards with the default card first (the others keep their order). "My QR" and event mode open the first one. */
export function defaultFirst<T extends { is_default?: boolean }>(cards: T[]): T[] {
  const at = cards.findIndex((c) => c.is_default);
  if (at <= 0) return cards;
  return [cards[at], ...cards.slice(0, at), ...cards.slice(at + 1)];
}

/** The ids with one card moved a place up (-1) or down (1). Unknown ids and moves past either end change nothing. */
export function moveId(ids: string[], id: string, dir: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** How a card is named in a list or a switcher: the private label first, then the name on the card. */
export function cardListName(card: Pick<Card, "label" | "name">, fallback: string): string {
  const label = (card.label ?? "").trim();
  const name = card.name.trim();
  if (label && name) return `${label} - ${name}`;
  return label || name || fallback;
}

/** The plan's card allowance for a personal workspace: how many are used, how many are allowed and whether one more fits. */
export function cardAllowance(used: number, max: number | null | undefined): { used: number; max: number | null; canAdd: boolean } {
  return { used, max: max ?? null, canAdd: max == null || used < max };
}
