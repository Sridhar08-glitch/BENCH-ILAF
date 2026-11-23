// Search over the help articles, in the browser. Text is normalised so that Arabic written with or without marks,
// with different alef or yeh shapes, or with Arabic-Indic digits still matches, and English ignores case and accents.
import type { Audience } from "@/lib/guide/types";

export interface Searchable {
  slug: string;
  title: string;
  summary: string;
  audience: Audience[];
  /** The article text without Markdown marks. */
  text: string;
}

/** Lower-case, no accents, no Arabic marks or tatweel, one alef, one yeh, one heh, Western digits, single spaces. */
export function normalise(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[ً-ٰٟۖ-ۭـ]/g, "") // Arabic marks and tatweel
    .replace(/[̀-ͯ]/g, "") // Latin accents
    .replace(/[آأإٱ]/g, "ا") // alef shapes
    .replace(/ى/g, "ي") // alef maqsura to yeh
    .replace(/ة/g, "ه") // teh marbuta to heh
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // Arabic-Indic digits
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) // extended digits
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    // The Arabic definite article is not part of the word being looked for.
    .map((w) => (w.length > 4 && w.startsWith("ال") ? w.slice(2) : w))
    .join(" ");
}

/** The words of a query. A word needs to be at least 2 letters, or 1 digit. */
export function words(query: string): string[] {
  return normalise(query).split(" ").filter((w) => w.length >= 2 || /\d/.test(w));
}

export interface Hit {
  item: Searchable;
  score: number;
}

/**
 * Articles that contain every word of the query, best first. A word in the title counts most, then the summary, then
 * the text. A word also matches the start of longer words (so "publi" finds "publish").
 */
export function search(items: Searchable[], query: string, audience?: Audience | null): Hit[] {
  const q = words(query);
  const pool = audience ? items.filter((i) => i.audience.length === 0 || i.audience.includes(audience)) : items;
  if (q.length === 0) return pool.map((item) => ({ item, score: 0 }));
  const hits: Hit[] = [];
  for (const item of pool) {
    const title = normalise(item.title);
    const summary = normalise(item.summary);
    const text = normalise(item.text);
    let score = 0;
    let all = true;
    for (const w of q) {
      const inTitle = hasWord(title, w);
      const inSummary = hasWord(summary, w);
      const inText = hasWord(text, w);
      if (!inTitle && !inSummary && !inText) {
        all = false;
        break;
      }
      score += (inTitle ? 6 : 0) + (inSummary ? 3 : 0) + (inText ? 1 : 0);
    }
    if (all) hits.push({ item, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
}

function hasWord(haystack: string, word: string): boolean {
  if (!haystack) return false;
  return (" " + haystack).includes(" " + word);
}
