// Draws a card page from real card data. Works on the server (first byte of the public page) and in the browser
// (live preview in the editor); the engine is plain string work with no DOM.
import { renderPage, renderTab as engineTab } from "./generated/engine";
import { iconHex, iconHtml } from "./icons";
import { brandChip, chipBase } from "./chip";
import { COMPANY_COLOUR, effectiveColour, normalizeDesign, resolveColours } from "./index";
import { FONT_FACE, textClasses, textVars } from "./text";
import { composeCompany } from "./company/compose";
import { customColours, customFront, swapFront } from "./custom/render";
import type { CardMode, CardPageData, EngineInput, EngineItem, EngineResult } from "./types";
import { buildEntries, splitName, type Entry } from "@/lib/card/entries";
import { initials } from "@/lib/card/design";
import { opensInNewTab } from "@/lib/card/href";
import { qrShape } from "@/lib/card/qr";
import { platformOf } from "@/lib/card/catalogue";
import { KIND_SHORT } from "@/lib/card/label-keys";
import { cardI18n, cardLabels, localiseChrome } from "@/lib/card/labels";
import { wrapArabicRuns } from "@/lib/card/bidi";
import { withoutRepeatedButtons } from "./dedupe";
import type { TFunction } from "@/lib/i18n";

/** Text shown under a button's label: addresses without the scheme and the trailing slash. */
export function prettyValue(kind: string, value: string): string {
  const v = value.trim();
  if (kind === "Location") return v;
  return v.replace(/^(https?:\/\/|mailto:|tel:|sms:)/i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

/** Names under icons that are shorter than the label. */
const SHORT_NAMES: Record<string, string> = { Location: "Directions", Calendly: "Meet" };

/** One button as the engine draws it. With the page background known, the chip colours for "use brand colours" are worked out too. */
export function engineItem(e: Entry, pageBg?: string, t?: TFunction): EngineItem {
  const base = chipBase(e.kind, e.res);
  const chip = base && pageBg ? brandChip(base, pageBg) : null;
  return {
    kind: e.kind,
    label: e.label,
    short: e.kind === "Custom" ? e.label : t && KIND_SHORT[e.kind] ? t(KIND_SHORT[e.kind]) : SHORT_NAMES[e.kind] ?? platformOf(e.kind).name,
    value: prettyValue(e.kind, e.value),
    href: e.href,
    newTab: !!e.href && opensInNewTab(e.href),
    group: e.group,
    hex: iconHex(e.kind, e.res),
    bc: chip?.bc ?? null,
    bf: chip?.bf ?? null,
    iconHtml: iconHtml(e.kind, e.res),
  };
}

export function buildInput(data: CardPageData, mode: CardMode = "live", flipped = false): EngineInput {
  const palette = data.brand?.palette ?? null;
  const design = { ...normalizeDesign(data.design) };
  // Company colours (colour 4) only exist when the company has a palette; otherwise the face's first colourway is used.
  design.colour = effectiveColour(design.colour, palette);
  // The company's own face replaces the library face when the design chooses it and the face was sent along. Its four colourways
  // stand in for the library face's; colour 4 (company colours) works as before.
  const custom = data.customFace && design.custom_face === data.customFace.id ? data.customFace : null;
  const own = custom && design.colour !== COMPANY_COLOUR ? customColours(custom, design.colour) : null;
  if (custom?.font_locked) design.font = FONT_FACE;
  const page = own ? own.pageVars : resolveColours(design, palette).pageVars;
  const locale = data.locale ?? "en";
  const ci = cardI18n(locale);
  const labels = cardLabels(ci);
  const entries = buildEntries(data.items, data.address, ci.t);
  const { first, last } = splitName(data.name);
  return {
    person: {
      name: data.name.trim(), first, last, title: data.title.trim(), company: data.company.trim(), address: data.address.trim(), bio: (data.bio ?? "").trim(),
      initials: initials(data.name), photoUrl: data.photoUrl, coverUrl: data.coverUrl ?? null,
    },
    items: entries.map((e) => engineItem(e, page["--pgbg"], ci.t)),
    publicUrl: data.publicUrl,
    qr: qrShape(data.publicUrl),
    design,
    mode,
    saveContact: data.saveContact,
    footer: data.footer ?? design.foot,
    footerText: labels.footer,
    locale,
    labels,
    // The company logo is laid on by composeCompany, so the engine never draws its own.
    brand: null,
    palette: own ? { bg: own.bg, bg2: own.bg2, fg: own.fg, acc: own.acc, on: own.on } : design.colour === COMPANY_COLOUR ? palette : null,
    page,
    flipped,
    custom,
  };
}

/**
 * A card face has its QR code on the back. A page style has no back, so its QR code is drawn at the end of the page,
 * above the footer. Inline styles only, with the page colours, so it needs no new stylesheet.
 */
export function pageQr(input: EngineInput): string {
  const q = input.qr;
  if (!q || !q.d || input.design.top <= 0 || input.mode === "thumb") return "";
  const caption = input.labels?.back ?? "Scan to save my contact";
  const aria = input.labels?.qr ?? "QR code";
  const svg = `<svg viewBox="0 0 ${q.size} ${q.size}" shape-rendering="crispEdges" role="img" aria-label="${aria.replace(/"/g, "&quot;")}" style="width:132px;height:132px;display:block;border-radius:10px"><rect width="${q.size}" height="${q.size}" fill="#fff"/><path d="${q.d}" fill="#0B1020"/></svg>`;
  return `<div class="pg-qr" style="display:flex;flex-direction:column;align-items:center;gap:8px;margin:20px auto 6px;color:var(--pgfg);font-size:12px;text-align:center">${svg}<span style="opacity:.75">${caption}</span></div>`;
}

export interface DrawnPage extends EngineResult {
  /** Classes for the `.cfl` wrapper (company artwork switches). */
  wrapClass: string;
}

/** Draw a built card page and, for a company card, lay the company brand on it. */
export function drawPage(input: EngineInput, data: Pick<CardPageData, "brand">, mode: CardMode = "live"): DrawnPage {
  const raw = renderPage(input);
  // A header and the list under it must not both show the same button.
  raw.html = withoutRepeatedButtons(raw.html);
  const qr = pageQr(input);
  if (qr) raw.html = raw.html.includes('<div class="foot">') ? raw.html.replace('<div class="foot">', qr + '<div class="foot">') : raw.html + qr;
  // The typeface and size of the name, title and contact lines are a class and a few variables on the card wrapper.
  const text = textClasses(input.design);
  if (text) raw.pageVars = { ...raw.pageVars, ...textVars(input.design) };
  // A custom face takes the place of the front the engine drew; its style sheet is added in front of the page afterwards.
  const front = input.custom ? customFront(input.custom, input, data.brand) : null;
  if (front) raw.html = swapFront(raw.html, front.html);
  // The design words and the fixed engine words follow the card's language; Arabic text of any card gets its own font and direction.
  const out = { ...raw, html: wrapArabicRuns(input.labels ? localiseChrome(raw.html, input.locale ?? "en", input.labels) : raw.html) };
  const styled = (html: string) => (front ? front.style + html : html);
  if (!data.brand) return { ...out, html: styled(out.html), wrapClass: text };
  const c = composeCompany(out, input, data.brand, mode === "thumb", { customLogo: !!front?.ownLogo });
  return { ...out, html: styled(c.html), pageVars: c.pageVars, wrapClass: [c.wrapClass, text].filter(Boolean).join(" ") };
}

/** The card page markup for one card, ready to go inside a `.cfl` wrapper. */
export function renderCardPage(data: CardPageData, mode: CardMode = "live", flipped = false): DrawnPage {
  return drawPage(buildInput(data, mode, flipped), data, mode);
}

/**
 * Layouts with tabs fill the tabs in the browser, so without scripts a visitor would only get the first group.
 * This adds the other groups as plain lists inside <noscript>, which browsers with scripts never show,
 * and hides the tab buttons that could not be used.
 */
export function withoutScriptTabs(input: EngineInput, html: string): string {
  if (!html.includes("data-tab=")) return html;
  const groups = (["c", "s", "w"] as const).map((g) => renderTab(input, g)).filter((rows) => rows.trim() !== "");
  if (groups.length < 2) return html;
  const harm = input.design.brand_colors ? "" : " harm";
  const layout = /class="dv (dv\d+) /.exec(html)?.[1] ?? "";
  const blocks = groups.slice(1).map((rows) => `<div class="dv ${layout} k0${harm}"><div class="tabc" style="margin-top:8px">${rows}</div></div>`).join("");
  const extra = `<noscript><style>.cfl .tabs3{display:none!important}</style>${blocks}</noscript>`;
  return html.includes('<div class="foot">') ? html.replace('<div class="foot">', `${extra}<div class="foot">`) : html + extra;
}

/** The buttons of one tab group, with the same Arabic handling as the page. */
export function renderTab(input: EngineInput, group: "c" | "s" | "w"): string {
  return wrapArabicRuns(engineTab(input, group));
}

export { renderPage };
