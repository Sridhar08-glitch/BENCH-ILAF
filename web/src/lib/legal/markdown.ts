// A very small Markdown reader for the legal texts in web/content/legal/*.md, so the owner's lawyer can edit plain text files.
// Supported: "#", "##", "###" headings, paragraphs, "- " bullet lists, **bold**, [text](link). No raw HTML is ever passed through.
// A line that starts with "%%" is a note for the editor of the text and is never shown.

export type Inline = { kind: "text"; text: string } | { kind: "bold"; text: string } | { kind: "link"; text: string; href: string };
export type Block =
  | { kind: "h1" | "h2" | "h3"; inline: Inline[] }
  | { kind: "p"; inline: Inline[] }
  | { kind: "ul"; items: Inline[][] };

/** Replace {{NAME}} markers with their values. A marker with no value is left visible so a missing setting is obvious. */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (all, name: string) => (values[name] !== undefined && values[name] !== "" ? values[name] : all));
}

/** Only web, mail and same-site links are kept; anything else (javascript:, data:) is shown as plain text. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\/[^\s"<>]+$/i.test(h)) return h;
  if (/^mailto:[^\s@"<>]+@[^\s@"<>]+$/i.test(h)) return h;
  if (/^\/(?!\/)[^\s"<>]*$/.test(h)) return h;
  return null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else {
      const href = safeHref(m[3]);
      out.push(href ? { kind: "link", text: m[2], href } : { kind: "text", text: m[2] });
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ kind: "text", text: src.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Inline[][] | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", inline: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "ul", items: list });
    list = null;
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("%%")) continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: (["h1", "h2", "h3"] as const)[heading[1].length - 1], inline: parseInline(heading[2]) });
    } else if (bullet) {
      flushPara();
      (list ??= []).push(parseInline(bullet[1]));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}
