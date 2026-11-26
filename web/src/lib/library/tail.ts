// The end of a card page (the QR code of a page style and the "Powered by" line) can be drawn after the extras
// under the card instead of before them. This cuts it off the page markup so it can be drawn later.
const TAIL = /<div class="pg-qr"|<div class="foot">/;

export function splitTail(html: string): { main: string; tail: string } {
  const at = html.search(TAIL);
  if (at < 0 || !html.endsWith("</div>")) return { main: html, tail: "" };
  // The page is one box that ends with the tail, so the last closing tag belongs to the box and stays with the main part.
  return { main: html.slice(0, at) + "</div>", tail: html.slice(at, html.length - "</div>".length) };
}
