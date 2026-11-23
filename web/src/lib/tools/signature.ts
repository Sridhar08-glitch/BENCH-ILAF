// The e-mail signature maker. Pure functions: a card's details go in, e-mail-safe HTML and plain text come out.
//
// Rules the HTML follows so Gmail, Outlook (desktop and web), Apple Mail and phone mail apps show it the same:
// nested tables for layout, every style inline, no <style>, no classes, no scripts, no web fonts (Arial first),
// no CSS background images or url(), every picture an absolute address with width and height written as
// attributes (Outlook ignores CSS sizes), buttons made from a table cell with a bgcolor plus a styled link.
//
// A right-to-left signature (Arabic) writes dir="rtl" on every table, aligns text to the right, swaps the sides
// of paddings and borders and uses a font stack with Arabic letters. Mail apps ignore logical CSS, so the physical
// sides are written out here.
import { isSafeHref } from "@/lib/card/href";
import { tk, type MessageKey, type TFunction } from "@/lib/i18n";

export type SignatureTemplate = "compact" | "classic" | "banner" | "minimal";

export const TEMPLATES: { key: SignatureTemplate; name: MessageKey; hint: MessageKey }[] = [
  { key: "compact", name: tk("tools.sigCompact"), hint: tk("tools.sigCompactHint") },
  { key: "classic", name: tk("tools.sigClassic"), hint: tk("tools.sigClassicHint") },
  { key: "banner", name: tk("tools.sigBanner"), hint: tk("tools.sigBannerHint") },
  { key: "minimal", name: tk("tools.sigMinimal"), hint: tk("tools.sigMinimalHint") },
];

export interface SignatureColours {
  bg: string;
  bg2: string;
  fg: string;
  acc: string;
  on: string;
}

export type PaletteChoice = "card" | "company" | "default";

/** The product's ink and orange, used when the owner picks neither the card nor the company colours. */
export const DEFAULT_COLOURS: SignatureColours = { bg: "#101114", bg2: "#F6F7F9", fg: "#FFFFFF", acc: "#FF6B35", on: "#101114" };

export interface SignatureData {
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  /** Full https address of the photo, or null. */
  photoUrl: string | null;
  /** Full https address of the company logo (a PNG or JPG), or null. */
  logoUrl: string | null;
  /** Full https address of the card's QR code as a PNG. */
  qrUrl: string | null;
  /** The card page, linked from the QR code and the "View my card" button. */
  cardUrl: string;
  /** Extra link buttons (label and a safe link). */
  buttons: { label: string; href: string }[];
}

/** The words the signature itself contains (button, picture descriptions), in the signature's language. */
export interface SignatureLabels {
  viewCard: string;
  /** "My card", used before the link in the plain text version. */
  myCard: string;
  photoAlt: string;
  logoAlt: string;
  /** Description of the QR picture; gets the person's name (may be empty). */
  qrAlt: (name: string) => string;
}

export interface SignatureOptions {
  template: SignatureTemplate;
  showPhoto: boolean;
  showQr: boolean;
  showButtons: boolean;
  colours: SignatureColours;
  labels: SignatureLabels;
  /** Right to left layout, for Arabic. */
  rtl?: boolean;
}

/** The labels of a signature in the language `t` speaks. */
export function signatureLabels(t: TFunction): SignatureLabels {
  return {
    viewCard: t("tools.sigViewCard"),
    myCard: t("tools.sigMyCard"),
    photoAlt: t("tools.sigPhotoAlt"),
    logoAlt: t("tools.sigLogoAlt"),
    qrAlt: (name) => t("tools.sigQrAlt", { name: name || t("tools.sigMyCardName") }),
  };
}

const FONT = "Arial,Helvetica,sans-serif";
const FONT_RTL = "Tahoma,Arial,Helvetica,sans-serif";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A picture address that is safe to put in a mail: https (http only for a local test address). */
export function imageSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\/[^\s"'<>]+$/i.test(url.trim()) ? url.trim() : null;
}

/** What differs between left to right and right to left, worked out once per signature. */
interface Layout {
  rtl: boolean;
  font: string;
  /** The side text starts on and the side it ends on, as physical CSS words. */
  start: "left" | "right";
  end: "left" | "right";
  /** Attribute for every table, and the text alignment style for cells. */
  table: string;
  align: string;
}

function layoutOf(o: Pick<SignatureOptions, "rtl">): Layout {
  const rtl = !!o.rtl;
  return {
    rtl,
    font: rtl ? FONT_RTL : FONT,
    start: rtl ? "right" : "left",
    end: rtl ? "left" : "right",
    table: `role="presentation" cellpadding="0" cellspacing="0" border="0"${rtl ? ' dir="rtl"' : ""}`,
    align: `text-align:${rtl ? "right" : "left"};`,
  };
}

function link(href: string, text: string, colour: string, extra = ""): string {
  if (!isSafeHref(href)) return esc(text);
  return `<a href="${esc(href)}" target="_blank" style="color:${colour};text-decoration:none;${extra}">${esc(text)}</a>`;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function webHref(site: string): string {
  return /^https?:\/\//i.test(site) ? site : `https://${site.replace(/^\/+/, "")}`;
}

function shortSite(site: string): string {
  return site.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function img(src: string, w: number, h: number, alt: string, round = false): string {
  return `<img src="${esc(src)}" width="${w}" height="${h}" alt="${esc(alt)}" style="display:block;border:0;outline:none;width:${w}px;height:${h}px;${round ? `border-radius:${Math.round(w / 2)}px;` : ""}">`;
}

/** A phone number, address or link inside right-to-left text keeps its own left-to-right order. */
function ltr(html: string, L: Layout): string {
  return L.rtl ? `<span dir="ltr" style="unicode-bidi:embed;">${html}</span>` : html;
}

/** Phone, e-mail and website as one line of links separated by thin dividers. */
function contactLine(d: SignatureData, c: SignatureColours, ink: string, size: number, L: Layout): string {
  const parts: string[] = [];
  if (d.phone.trim()) parts.push(link(telHref(d.phone), d.phone.trim(), ink));
  if (d.email.trim()) parts.push(link(`mailto:${d.email.trim()}`, d.email.trim(), ink));
  if (d.website.trim()) parts.push(link(webHref(d.website.trim()), shortSite(d.website.trim()), ink));
  const sep = `<span style="color:${c.acc};padding:0 6px;">|</span>`;
  const nowrap = parts.map((p) => `<span style="white-space:nowrap;">${ltr(p, L)}</span>`);
  return parts.length ? `<tr><td style="font-family:${L.font};${L.align}font-size:${size}px;line-height:${size + 6}px;color:${ink};padding-top:6px;">${nowrap.join(sep)}</td></tr>` : "";
}

function nameBlock(d: SignatureData, ink: string, sub: string, nameSize: number, L: Layout): string {
  const role = [d.title.trim(), d.company.trim()].filter(Boolean).map(esc).join(" &middot; ");
  return (
    (d.name.trim() ? `<tr><td style="font-family:${L.font};${L.align}font-size:${nameSize}px;line-height:${nameSize + 6}px;font-weight:bold;color:${ink};">${esc(d.name.trim())}</td></tr>` : "") +
    (role ? `<tr><td style="font-family:${L.font};${L.align}font-size:13px;line-height:19px;color:${sub};">${role}</td></tr>` : "")
  );
}

function addressRow(d: SignatureData, sub: string, L: Layout): string {
  return d.address.trim() ? `<tr><td style="font-family:${L.font};${L.align}font-size:12px;line-height:18px;color:${sub};padding-top:4px;">${esc(d.address.trim().replace(/\s*\n\s*/g, ", "))}</td></tr>` : "";
}

function buttonsRow(d: SignatureData, o: SignatureOptions, L: Layout): string {
  if (!o.showButtons) return "";
  const list = [{ label: o.labels.viewCard, href: d.cardUrl }, ...d.buttons].filter((b) => isSafeHref(b.href) && b.label.trim()).slice(0, 4);
  if (!list.length) return "";
  const cells = list
    .map(
      (b) =>
        `<td bgcolor="${o.colours.acc}" style="background-color:${o.colours.acc};border-radius:14px;padding:0;"><a href="${esc(b.href)}" target="_blank" style="display:inline-block;padding:5px 12px;font-family:${L.font};font-size:12px;line-height:16px;font-weight:bold;color:${o.colours.on};text-decoration:none;border-radius:14px;">${esc(b.label.trim())}</a></td>`,
    )
    .join(`<td width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>`);
  return `<tr><td style="padding-top:10px;${L.align}"><table ${L.table}><tr>${cells}</tr></table></td></tr>`;
}

function qrCell(d: SignatureData, o: SignatureOptions, size: number, L: Layout): string {
  const src = imageSrc(d.qrUrl);
  if (!o.showQr || !src) return "";
  const picture = img(src, size, size, o.labels.qrAlt(d.name));
  const inner = isSafeHref(d.cardUrl) ? `<a href="${esc(d.cardUrl)}" target="_blank" style="text-decoration:none;border:0;">${picture}</a>` : picture;
  return `<td width="${size + 16}" valign="top" align="${L.end}" style="padding-${L.start}:16px;">${inner}</td>`;
}

function compact(d: SignatureData, o: SignatureOptions): string {
  const c = o.colours;
  const L = layoutOf(o);
  const ink = "#101114";
  return (
    `<table ${L.table} style="border-collapse:collapse;"><tr>` +
    `<td valign="top" style="border-${L.start}:3px solid ${c.acc};padding-${L.start}:10px;"><table ${L.table}>` +
    nameBlock(d, ink, "#555B66", 15, L) +
    contactLine(d, c, ink, 12, L) +
    buttonsRow(d, o, L) +
    `</table></td>${qrCell(d, o, 64, L)}</tr></table>`
  );
}

function classic(d: SignatureData, o: SignatureOptions): string {
  const c = o.colours;
  const L = layoutOf(o);
  const ink = "#101114";
  const photo = imageSrc(d.photoUrl);
  const photoCell = o.showPhoto && photo ? `<td width="96" valign="top" style="padding-${L.end}:16px;">${img(photo, 80, 80, d.name || o.labels.photoAlt, true)}</td>` : "";
  return (
    `<table ${L.table} style="border-collapse:collapse;"><tr>${photoCell}` +
    `<td valign="top"><table ${L.table}>` +
    nameBlock(d, ink, "#555B66", 17, L) +
    `<tr><td style="padding-top:6px;"><table ${L.table}><tr><td width="40" height="3" bgcolor="${c.acc}" style="background-color:${c.acc};width:40px;height:3px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>` +
    contactLine(d, c, ink, 13, L) +
    addressRow(d, "#555B66", L) +
    buttonsRow(d, o, L) +
    `</table></td>${qrCell(d, o, 84, L)}</tr></table>`
  );
}

function banner(d: SignatureData, o: SignatureOptions): string {
  const c = o.colours;
  const L = layoutOf(o);
  const logo = imageSrc(d.logoUrl);
  const photo = imageSrc(d.photoUrl);
  const ink = "#101114";
  const head = logo
    ? img(logo, 120, 36, d.company || o.labels.logoAlt).replace("display:block;", "display:block;object-fit:contain;")
    : `<span style="font-family:${L.font};font-size:16px;font-weight:bold;color:${c.fg};">${esc(d.company || d.name)}</span>`;
  const photoCell = o.showPhoto && photo ? `<td width="76" valign="top" style="padding-${L.end}:14px;">${img(photo, 62, 62, d.name || o.labels.photoAlt, true)}</td>` : "";
  return (
    `<table ${L.table} width="460" style="border-collapse:collapse;width:460px;max-width:100%;">` +
    `<tr><td bgcolor="${c.bg}" style="background-color:${c.bg};padding:12px 16px;border-radius:8px 8px 0 0;${L.align}"><table ${L.table} width="100%"><tr><td valign="middle" align="${L.start}">${head}</td>` +
    `<td valign="middle" align="${L.end}" width="6" bgcolor="${c.acc}" style="background-color:${c.acc};width:6px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>` +
    `<tr><td style="border:1px solid #E8E9ED;border-top:0;padding:14px 16px;border-radius:0 0 8px 8px;"><table ${L.table} width="100%"><tr>${photoCell}` +
    `<td valign="top"><table ${L.table}>` +
    nameBlock(d, ink, "#555B66", 16, L) +
    contactLine(d, c, ink, 12, L) +
    addressRow(d, "#555B66", L) +
    buttonsRow(d, o, L) +
    `</table></td>${qrCell(d, o, 72, L)}</tr></table></td></tr></table>`
  );
}

function minimal(d: SignatureData, o: SignatureOptions): string {
  const c = o.colours;
  const L = layoutOf(o);
  const ink = "#101114";
  const parts: string[] = [];
  if (d.phone.trim()) parts.push(ltr(link(telHref(d.phone), d.phone.trim(), ink), L));
  if (d.email.trim()) parts.push(ltr(link(`mailto:${d.email.trim()}`, d.email.trim(), ink), L));
  if (d.website.trim()) parts.push(ltr(link(webHref(d.website.trim()), shortSite(d.website.trim()), ink), L));
  const role = [d.title.trim(), d.company.trim()].filter(Boolean).map(esc).join(L.rtl ? "، " : ", ");
  return (
    `<table ${L.table} style="border-collapse:collapse;"><tr><td valign="top">` +
    `<table ${L.table}>` +
    `<tr><td style="font-family:${L.font};${L.align}font-size:14px;line-height:20px;color:${ink};"><b>${esc(d.name.trim())}</b>${role ? `<span style="color:#555B66;"> - ${role}</span>` : ""}</td></tr>` +
    (parts.length ? `<tr><td style="font-family:${L.font};${L.align}font-size:12px;line-height:18px;color:${ink};">${parts.join(" &nbsp;&middot;&nbsp; ")}</td></tr>` : "") +
    `<tr><td style="padding-top:6px;"><table ${L.table}><tr><td width="100%" height="2" bgcolor="${c.acc}" style="background-color:${c.acc};width:120px;height:2px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>` +
    buttonsRow(d, o, L) +
    `</table></td>${qrCell(d, o, 56, L)}</tr></table>`
  );
}

/** The signature as e-mail-safe HTML (a fragment; the mail app puts it inside its own body). */
export function buildSignatureHtml(d: SignatureData, o: SignatureOptions): string {
  switch (o.template) {
    case "classic":
      return classic(d, o);
    case "banner":
      return banner(d, o);
    case "minimal":
      return minimal(d, o);
    default:
      return compact(d, o);
  }
}

/** The same signature as plain text, for mail apps and people who read mail as text. */
export function buildSignatureText(d: SignatureData, o: Pick<SignatureOptions, "showButtons" | "labels" | "rtl">): string {
  const lines: string[] = [];
  if (d.name.trim()) lines.push(d.name.trim());
  const role = [d.title.trim(), d.company.trim()].filter(Boolean).join(o.rtl ? "، " : ", ");
  if (role) lines.push(role);
  const contact = [d.phone.trim(), d.email.trim(), d.website.trim() ? shortSite(d.website.trim()) : ""].filter(Boolean);
  if (contact.length) lines.push(contact.join(" | "));
  if (d.address.trim()) lines.push(d.address.trim().replace(/\s*\n\s*/g, o.rtl ? "، " : ", "));
  if (o.showButtons && isSafeHref(d.cardUrl)) lines.push(`${o.labels.myCard}: ${d.cardUrl}`);
  return lines.join("\n");
}

/** What is wrong with a signature, as codes the screen turns into sentences. An empty list means it follows every rule. */
export type HtmlProblem =
  | "styleBlock" | "stylesheet" | "script" | "cssClass" | "cssUrl" | "webFont" | "eventHandler" | "jsLink"
  | "relativePicture" | "pictureSize" | "pictureAlt" | "notTables" | "tableAttrs";

export const PROBLEM_KEYS: Record<HtmlProblem, MessageKey> = {
  styleBlock: tk("tools.sigProbStyle"),
  stylesheet: tk("tools.sigProbStylesheet"),
  script: tk("tools.sigProbScript"),
  cssClass: tk("tools.sigProbClass"),
  cssUrl: tk("tools.sigProbUrl"),
  webFont: tk("tools.sigProbFont"),
  eventHandler: tk("tools.sigProbEvent"),
  jsLink: tk("tools.sigProbJsLink"),
  relativePicture: tk("tools.sigProbRelative"),
  pictureSize: tk("tools.sigProbSize"),
  pictureAlt: tk("tools.sigProbAlt"),
  notTables: tk("tools.sigProbTables"),
  tableAttrs: tk("tools.sigProbTableAttrs"),
};

/** Problems that would make a signature look wrong in a mail app. An empty list means it follows every rule. */
export function emailHtmlProblems(html: string): HtmlProblem[] {
  const out: HtmlProblem[] = [];
  const add = (p: HtmlProblem) => { if (!out.includes(p)) out.push(p); };
  if (/<style[\s>]/i.test(html)) add("styleBlock");
  if (/<link[\s>]/i.test(html)) add("stylesheet");
  if (/<script[\s>]/i.test(html)) add("script");
  if (/\sclass\s*=/i.test(html)) add("cssClass");
  if (/url\s*\(/i.test(html)) add("cssUrl");
  if (/@import|@font-face/i.test(html)) add("webFont");
  if (/\son[a-z]+\s*=/i.test(html)) add("eventHandler");
  if (/javascript:/i.test(html)) add("jsLink");
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /\ssrc="([^"]*)"/i.exec(tag)?.[1] ?? "";
    if (!/^https?:\/\//i.test(src)) add("relativePicture");
    if (!/\swidth="\d+"/i.test(tag) || !/\sheight="\d+"/i.test(tag)) add("pictureSize");
    if (!/\salt="/i.test(tag)) add("pictureAlt");
  }
  if (!/<table\b/i.test(html)) add("notTables");
  for (const m of html.matchAll(/<table\b[^>]*>/gi)) {
    if (!/cellpadding="0"/.test(m[0]) || !/cellspacing="0"/.test(m[0]) || !/border="0"/.test(m[0])) add("tableAttrs");
  }
  return out;
}

/** The full document used for "Copy HTML source": the fragment wrapped so it can be pasted into any mail setting. */
export function wrapForSource(fragment: string): string {
  return `<!-- Email signature: paste into your mail app's HTML signature box -->\n${fragment}`;
}
