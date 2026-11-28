// Test helper: the texts of a page-style markup that sit inside an element marked `data-fx` (the person's own words and the button
// labels and values, the text the typeface and size settings reach; see scripts/build-pages.mjs and text.ts).
const VOID = new Set(["br", "img", "input", "hr", "wbr"]);

export function markedText(html: string): string {
  const out: string[] = [];
  const stack: { tag: string; fx: boolean }[] = [];
  let skip = 0;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*)>|([^<]+)/g)) {
    if (m[4] !== undefined) {
      if (!skip && stack.some((s) => s.fx)) out.push(m[4]);
      continue;
    }
    const [, closing, tag, attrs] = m;
    if (tag === "svg" || tag === "style") {
      skip += closing ? -1 : 1;
      continue;
    }
    if (skip || VOID.has(tag) || attrs.endsWith("/")) continue;
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
    } else stack.push({ tag, fx: /\sdata-fx(?=[\s=>]|$)/.test(attrs) });
  }
  return out.join(" ");
}

/**
 * The text the typeface and size settings reach in a page style: the marked text, plus the name, title and company blocks of the
 * face card that a Blinq-style header holds (`.pg-fc`; the face rules of the text settings reach those).
 */
export function reachedText(html: string): string {
  const face = html.includes('class="pg-fc"') ? Array.from(html.matchAll(/<div class="(?:n|t1|t2|co)">(.*?)<\/div>/g), (m) => m[1].replace(/<[^>]*>/g, " ")).join(" ") : "";
  return `${markedText(html)} ${face}`;
}
