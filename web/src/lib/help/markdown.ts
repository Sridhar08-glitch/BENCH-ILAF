// The help article reader. It builds on the legal Markdown reader (inline bold and safe links) and adds numbered
// lists, tips ("> text") and the product name placeholder. No raw HTML is ever passed through.
//   ## and ### headings, paragraphs, - bullets, 1. numbered steps, > tip, **bold**, [text](/app/page)
import { parseInline, type Inline } from "@/lib/legal/markdown";

export type HelpBlock =
  | { kind: "h2"; inline: Inline[]; id: string }
  | { kind: "h3"; inline: Inline[]; id: string }
  | { kind: "p"; inline: Inline[] }
  | { kind: "ul"; items: Inline[][] }
  | { kind: "ol"; items: Inline[][] }
  | { kind: "tip"; inline: Inline[] };

/** {{APP}} becomes the product name; nothing else is replaced. */
export function fillApp(text: string, app: string): string {
  return text.replace(/\{\{APP\}\}/g, app);
}

/** An anchor id from a heading, keeping Arabic letters. */
export function slugOf(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "section";
}

export function parseHelp(src: string): HelpBlock[] {
  const out: HelpBlock[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: Inline[][] } | null = null;
  let tip: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", inline: parseInline(para.join(" ")) });
    para = [];
    if (list) out.push(list);
    list = null;
    if (tip.length) out.push({ kind: "tip", inline: parseInline(tip.join(" ")) });
    tip = [];
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      out.push({ kind: heading[1].length === 2 ? "h2" : "h3", inline: parseInline(heading[2]), id: slugOf(heading[2]) });
    } else if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const text = (bullet ?? numbered)![1];
      if (list && list.kind !== kind) flush();
      if (para.length || tip.length) flush();
      (list ??= { kind, items: [] }).items.push(parseInline(text));
    } else if (quote) {
      if (para.length || list) flush();
      tip.push(quote[1]);
    } else {
      if (list || tip.length) flush();
      para.push(line);
    }
  }
  flush();
  return out;
}

/** The plain text of a body, for search. */
export function plainText(src: string): string {
  return src
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`]/g, " ")
    .replace(/^\s*(?:[-]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every internal link target (/app/..., /help...) in a body, for the broken-link check. */
export function internalLinks(src: string): string[] {
  const found: string[] = [];
  const re = /\[[^\]]+\]\((\/[^)\s]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) found.push(m[1]);
  return found;
}
