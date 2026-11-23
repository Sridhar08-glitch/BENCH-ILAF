// Text direction helpers for card content. A card's name, title, company and address are typed by the owner and
// may be Arabic, Latin or both in one line ("Khalid خالد Al Thani"). The card designs are drawn left to right, so
// they are not mirrored; instead every Arabic run is marked so it gets an Arabic font, no letter spacing and its
// own direction, and a text block that is entirely Arabic can be aligned to the right.

const ARABIC = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
const ARABIC_CHAR = new RegExp(`[${ARABIC}]`);
// One Arabic run: Arabic letters, possibly with spaces, Arabic punctuation, digits and brackets between words.
const RUN = new RegExp(`[${ARABIC}](?:[${ARABIC}\\u200C\\u200D]|[\\s\\u00A0\\d.,:;!?()'"/\\u060C\\u061B\\u061F\\-]+(?=[${ARABIC}]))*`, "g");

export function hasArabic(text: string): boolean {
  return ARABIC_CHAR.test(text);
}

const LETTER = /\p{L}/u;

/** "rtl" when the first letter of the text is Arabic, "ltr" for any other letter, null when there are no letters (like dir="auto"). */
export function textDirection(text: string): "rtl" | "ltr" | null {
  for (const ch of text) {
    if (LETTER.test(ch)) return ARABIC_CHAR.test(ch) ? "rtl" : "ltr";
  }
  return null;
}

/** True when the Arabic letters are most of the letters of the text. */
export function mostlyArabic(text: string): boolean {
  let arabic = 0;
  let letters = 0;
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    letters++;
    if (ARABIC_CHAR.test(ch)) arabic++;
  }
  return letters > 0 && arabic * 2 > letters;
}

/** Text content of an HTML snippet written as it is typed into a text node: the owner's text is already escaped by the engine. */
function wrapText(text: string): string {
  if (!ARABIC_CHAR.test(text)) return text;
  const trimmed = text.trim();
  // The whole node is one Arabic block: the page can align its box to the right.
  const whole = trimmed.replace(RUN, "").trim() === "";
  if (whole) {
    const start = text.indexOf(trimmed);
    return `${text.slice(0, start)}<span class="ar ar-all" dir="rtl">${trimmed}</span>${text.slice(start + trimmed.length)}`;
  }
  return text.replace(RUN, (run) => `<span class="ar" dir="rtl">${run}</span>`);
}

/**
 * Mark the Arabic text of a drawn card page. Only text between tags is touched (never an attribute, a style or a
 * script), and a page without Arabic comes back unchanged.
 */
export function wrapArabicRuns(html: string): string {
  if (!ARABIC_CHAR.test(html)) return html;
  return html.replace(/>([^<>]+)</g, (all, text: string) => (ARABIC_CHAR.test(text) ? `>${wrapText(text)}<` : all));
}
