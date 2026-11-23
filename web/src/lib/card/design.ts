// Card design helpers. The design itself (faces, layouts, openings, colours) lives in the design library;
// this file only forwards the pieces the rest of the app imports from here.
export { defaultDesign, normalizeDesign } from "@/lib/library";

const ARABIC_LETTER = /[؀-ۿ]/;

/** First letter of an Arabic word, skipping the article "ال" ("الكواري" gives "ك"). */
function arabicInitial(word: string): string {
  const bare = word.length > 3 && /^ال/.test(word) ? word.slice(2) : word;
  return bare[0];
}

/**
 * Initials for the photo circle. Latin names use the first two words. A name with Arabic uses the first and the
 * last word, because the middle of an Arabic name is often "bin" or a father's name, and the two letters are kept
 * apart (a zero-width non-joiner) so they do not run together into one joined shape.
 */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.some((w) => ARABIC_LETTER.test(w))) {
    const picks = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]];
    return picks.map(arabicInitial).join("‌").toUpperCase() || "?";
  }
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}
