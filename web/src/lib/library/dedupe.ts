// A page-style header draws some of the buttons itself, and the layout under it (plus the engine's own "more" list for
// buttons that layout has no place for) can draw them again. This takes out of the part below the header every button the
// header already shows, so each button appears once. Faces draw no buttons of their own, so they are left alone.
const BELOW = /<div class="dv /;
const ANCHOR = /<a\b[^>]*\sdata-i="(\d+)"[^>]*>[\s\S]*?<\/a>/g;

/** The HiHello Flat page draws its buttons as tiles and then again as rows; the rows of a button that has a tile are dropped. */
function withoutTileRows(html: string): string {
  if (!html.includes('class="pg-gt"')) return html;
  const tiles = new Set([...html.matchAll(/<a\b[^>]*class="pg-gt"[^>]*\sdata-i="(\d+)"/g)].map((m) => m[1]));
  const out = html.replace(/<a\b[^>]*class="pg-rw"[^>]*\sdata-i="(\d+)"[^>]*>[\s\S]*?<\/a>/g, (a, i: string) => (tiles.has(i) ? "" : a));
  return out.replace(/<div class="pg-rows">\s*<\/div>/g, "");
}

export function withoutRepeatedButtons(input: string): string {
  const html = withoutTileRows(input);
  const at = html.search(BELOW);
  if (at < 0) return html;
  const before = html.slice(0, at);
  if (!before.includes(' data-i="')) return html;
  const rest = html.slice(at).replace(ANCHOR, (a, i: string) => (before.includes(`data-i="${i}"`) ? "" : a));
  // A "more" list left with no button is removed altogether.
  return before + rest.replace(/<div class="dv k0(?: harm)? more">\s*<\/div>/g, "");
}
