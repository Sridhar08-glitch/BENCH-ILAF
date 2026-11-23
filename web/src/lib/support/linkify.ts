// Turn web addresses in a message into links. Only http and https addresses become links, the text is never treated
// as HTML (the caller renders the parts as React text), and every link is opened with rel="noopener noreferrer nofollow".

export type Part = { type: "text"; value: string } | { type: "link"; value: string; href: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?)\]}»”’،؛؟]+$/;

export function linkify(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    let url = m[0];
    const trail = url.match(TRAILING)?.[0] ?? "";
    if (trail) url = url.slice(0, url.length - trail.length);
    let href: string | null = null;
    try {
      const u = new URL(url);
      if (u.protocol === "http:" || u.protocol === "https:") href = u.toString();
    } catch {
      href = null;
    }
    if (!href || url.length > 500) continue;
    if (start > last) parts.push({ type: "text", value: text.slice(last, start) });
    parts.push({ type: "link", value: url, href });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts.length ? parts : [{ type: "text", value: text }];
}
