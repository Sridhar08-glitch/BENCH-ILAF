// Button logos as ready-made markup for the card engine (which is plain string work, with no React).
// Same order as the rest of the app: the owner's own image, a brand logo, a generic icon, the platform's logo.
import type { ReactElement } from "react";
import { BUILT_IN, iconHex } from "@/components/ButtonIcon";
import { hasIcon, iconPath } from "@/components/Icon";
import { LUCIDE_ICONS } from "@/components/lucide-set";
import type { ResolvedIcon } from "@/lib/card/brand";
import { platformOf } from "@/lib/card/catalogue";

export function esc(t: string): string {
  return t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

const svg = (inner: string, fill = false) =>
  `<svg class="ico it" viewBox="0 0 24 24" aria-hidden="true"${fill ? ' style="fill:currentColor;stroke:none"' : ""}>${inner}</svg>`;

// ---- generic icons: the icon components are called directly and their element tree is written out

type Node = unknown;
interface El {
  type: unknown;
  props: Record<string, unknown>;
}

const isEl = (n: Node): n is El => !!n && typeof n === "object" && "type" in (n as object) && "props" in (n as object);

/** Run a component element until it is a plain tag such as svg or path. */
function settle(el: El): El {
  let cur = el;
  for (let guard = 0; guard < 8 && typeof cur.type !== "string"; guard++) {
    const t = cur.type as { render?: (p: unknown, r: unknown) => Node } | ((p: unknown) => Node);
    const out = typeof t === "function" ? t(cur.props) : t.render ? t.render(cur.props, null) : null;
    if (!isEl(out)) break;
    cur = out;
  }
  return cur;
}

const kebab = (k: string) => (k === "viewBox" ? k : k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));

function toHtml(n: Node): string {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return esc(String(n));
  if (Array.isArray(n)) return n.map(toHtml).join("");
  if (!isEl(n)) return "";
  const el = settle(n);
  if (typeof el.type !== "string") return "";
  const a = Object.entries(el.props)
    .filter(([k, v]) => k !== "children" && k !== "ref" && (typeof v === "string" || typeof v === "number"))
    .map(([k, v]) => ` ${kebab(k)}="${esc(String(v))}"`)
    .join("");
  return `<${el.type}${a}>${toHtml(el.props.children)}</${el.type}>`;
}

/** The drawing inside a Lucide icon (the shapes without the outer svg). */
function lucideInner(name: string): string {
  const C = (LUCIDE_ICONS[name] ?? LUCIDE_ICONS.link) as unknown as { render: (p: unknown, r: unknown) => ReactElement };
  const root = settle(C.render({ size: 20, strokeWidth: 1.8 }, null) as unknown as El);
  return toHtml(root.props.children);
}

/** The logo of one button as markup. */
export function iconHtml(kind: string, res?: ResolvedIcon): string {
  if (res?.t === "image") {
    return `<img class="ico it" src="${esc(res.url)}" alt="" style="object-fit:contain;border-radius:3px">`;
  }
  if (res?.t === "brand") return svg(`<path d="${esc(res.path)}"/>`, true);
  if (res?.t === "lucide") return svg(lucideInner(res.key));
  const icon = platformOf(kind).icon;
  if (icon.startsWith("b:")) {
    const slug = icon.slice(2);
    const b = BUILT_IN[slug];
    if (b) return svg(`<path d="${b.path}"/>`, true);
    return svg(`<path d="${iconPath(hasIcon(slug) ? slug : "link")}"/>`);
  }
  return svg(`<path d="${iconPath(icon.slice(2))}"/>`);
}

export { iconHex };
