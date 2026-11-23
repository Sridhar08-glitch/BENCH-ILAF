// Splits a line of text into runs of Arabic-script and other letters, so each run can be drawn with the font that has its glyphs
// (the Arabic font has no Latin letters and the Latin font has no Arabic ones). Pure: used by the share-preview image.

export interface Run {
  text: string;
  arabic: boolean;
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
// Latin and other letters, and ASCII digits: strong left-to-right text.
const LATIN = /[A-Za-z0-9À-ɏ]/;

/** Runs in logical order. Spaces and punctuation join the run before them (or the one after when the text starts with them). */
export function splitRuns(text: string): Run[] {
  const runs: Run[] = [];
  let pendingNeutral = "";
  for (const ch of text.replace(/\s+/g, " ").trim()) {
    const strong = ARABIC.test(ch) ? "ar" : LATIN.test(ch) ? "lt" : null;
    if (strong === null) {
      pendingNeutral += ch;
      continue;
    }
    const arabic = strong === "ar";
    const last = runs[runs.length - 1];
    if (last && last.arabic === arabic) {
      last.text += pendingNeutral + ch;
    } else if (last) {
      // A space between two runs belongs to neither (the layout puts a gap there); punctuation stays with the run before it.
      last.text += pendingNeutral.replace(/\s+/g, "");
      runs.push({ text: ch, arabic });
    } else {
      runs.push({ text: pendingNeutral.trim() + ch, arabic });
    }
    pendingNeutral = "";
  }
  const tail = pendingNeutral.trim();
  if (tail && runs.length) runs[runs.length - 1].text += tail;
  return runs;
}

/** True when the first letter of the text is Arabic: the line is read right to left. */
export function isRtlText(text: string): boolean {
  for (const ch of text) {
    if (ARABIC.test(ch)) return true;
    if (LATIN.test(ch)) return false;
  }
  return false;
}

/** The runs in the order they appear on screen, left to right. */
export function visualOrder(runs: Run[], rtl: boolean): Run[] {
  return rtl ? [...runs].reverse() : runs;
}

/** Up to two capital letters for the photo circle when a card has no photo. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? "" : "";
  return (first + last).toUpperCase();
}
