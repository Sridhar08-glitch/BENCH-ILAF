// Draws a company's custom face: the face's template is filled with the card's details and put in place of the front of
// the card the engine drew; the face's own style sheet goes in once, scoped to this face. Pure string work like the engine,
// so it runs on the server (first byte of the public page, no scripts needed) and in the browser (editor, studio, previews).
import { sanitizeFace } from "./sanitize";
import type { CustomFaceData, CustomFacePalette } from "./types";
import type { CompanyBrand, EngineInput } from "../types";
import { pageVarsOf } from "../page";

/** The five colours a card draws with (CSS variables --cbg, --cbg2, --cfg, --cacc, --con). */
export interface CardColours {
  name: string;
  bg: string;
  bg2: string;
  fg: string;
  acc: string;
  on: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The pictures of the company that a face may point at: the only addresses its template and CSS may use. */
export function ownMedia(brand: CompanyBrand | null | undefined): string[] {
  if (!brand) return [];
  return [brand.logoUrl, brand.symbolUrl, brand.backgroundUrl, brand.templateFrontUrl, brand.templateBackUrl].filter((u): u is string => !!u);
}

export interface CleanFace {
  template: string;
  css: string;
  /** Nothing in the stored text was removed or rewritten. */
  clean: boolean;
}

const cache = new Map<string, CleanFace>();

/** The face's template and CSS after the safety check, kept for the next draw of the same face. */
export function cleanFace(face: Pick<CustomFaceData, "id" | "hash" | "template" | "css">, media: readonly string[] = []): CleanFace {
  const key = `${face.id}|${face.hash}|${face.template.length}|${face.css.length}|${media.join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = sanitizeFace(face.template, face.css, face.id, media);
  // A face whose text cannot be checked is drawn empty rather than unchecked.
  const out: CleanFace = r.errors.length
    ? { template: "", css: "", clean: false }
    : { template: r.template, css: r.css, clean: r.template === face.template && r.css === face.css };
  if (cache.size > 64) cache.clear();
  cache.set(key, out);
  return out;
}

/** The colourway of a custom face (0 to 3); anything else is the first. */
export function customPalette(face: Pick<CustomFaceData, "palettes">, colour: number): CustomFacePalette {
  const list = face.palettes;
  return list[Number.isInteger(colour) && colour >= 0 && colour < list.length ? colour : 0] ?? list[0];
}

/** The colours and page colours a card with this face and colourway is drawn with. */
export function customColours(face: Pick<CustomFaceData, "palettes">, colour: number): CardColours & { pageVars: Record<string, string> } {
  const p = customPalette(face, colour);
  return { name: p.name, bg: p.bg, bg2: p.bg2, fg: p.fg, acc: p.acc, on: p.on, pageVars: pageVarsOf(p) };
}

const ICON = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
};
const ico = (p: string) =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const line = (path: string, text: string) => (text ? `<span class="ln">${ico(path)}<b>${text}</b></span>` : "");

/** What each placeholder of the template language stands for on one card. */
export function placeholderValues(input: EngineInput, brand: CompanyBrand | null | undefined): Record<string, string> {
  const p = input.person;
  const first = (kinds: string[]) => input.items.find((i) => kinds.includes(i.kind))?.value ?? "";
  const phone = esc(first(["Mobile", "Landline", "WhatsApp"]));
  const email = esc(first(["Email"]));
  const web = esc(first(["Website"]));
  const address = esc(p.address);
  const photoOn = !!input.design.photo && !!p.photoUrl;
  const qr = `<svg viewBox="0 0 ${input.qr.size} ${input.qr.size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${input.qr.size}" height="${input.qr.size}" fill="#fff"/><path d="${esc(input.qr.d)}" fill="#0B0B0B"/></svg>`;
  const logoUrl = brand?.logoUrl ?? "";
  const symbolUrl = brand?.symbolUrl || logoUrl;
  const mark = (url: string, cls: string) => (url ? `<img class="cfm ${cls}" alt="${esc(brand?.companyName ?? "")}" src="${esc(url)}">` : "");
  const lines = [line(ICON.phone, phone), line(ICON.mail, email), line(ICON.web, web), line(ICON.pin, address)].join("");
  return {
    name: esc(p.name), first: esc(p.first), last: esc(p.last), title: esc(p.title), company: esc(p.company), address, phone, email, web,
    initials: esc(p.initials),
    // The same element the engine's own faces use for the photo: the picture, or the initials when there is none or it is switched off.
    photo: photoOn ? `<img class="pic" alt="" src="${esc(p.photoUrl!)}">` : `<span class="pic">${esc(p.initials)}</span>`,
    qr, logo: mark(logoUrl, "cfm-logo"), symbol: mark(symbolUrl, "cfm-symbol"),
    phone_line: line(ICON.phone, phone), email_line: line(ICON.mail, email), web_line: line(ICON.web, web), address_line: line(ICON.pin, address), lines,
  };
}

/** A conditional is true when its value exists: a photo that is shown, a phone number, a company logo. */
function truthy(name: string, values: Record<string, string>, input: EngineInput): boolean {
  if (name === "photo") return !!input.design.photo && !!input.person.photoUrl;
  return (values[name] ?? "") !== "";
}

/** Fill a cleaned template: placeholders become the card's values, conditionals keep the branch that applies. */
export function fillTemplate(template: string, values: Record<string, string>, input: EngineInput): string {
  const out: string[] = [];
  const state: { parent: boolean; cond: boolean }[] = [];
  let active = true;
  let pos = 0;
  const re = /\{\{([^{}]*)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    if (active && m.index > pos) out.push(template.slice(pos, m.index));
    pos = m.index + m[0].length;
    const inner = m[1];
    if (inner.startsWith("#if ")) {
      const cond = truthy(inner.slice(4), values, input);
      state.push({ parent: active, cond });
      active = active && cond;
    } else if (inner === "else") {
      const top = state[state.length - 1];
      if (top) active = top.parent && !top.cond;
    } else if (inner === "/if") {
      const top = state.pop();
      if (top) active = top.parent;
    } else if (active && Object.prototype.hasOwnProperty.call(values, inner)) out.push(values[inner]);
  }
  if (active && pos < template.length) out.push(template.slice(pos));
  return out.join("");
}

/** Whether the face places the company logo itself (then the automatic corner logo is not added). */
export function usesLogo(template: string): boolean {
  return /\{\{(?:#if )?(?:logo|symbol)\}\}/.test(template);
}

/** The rules every face gets: the logo element fits its box. A face's own CSS comes after and can change them. */
function baseCss(id: number): string {
  const f = `.cfl .face.cf-${id}`;
  return [
    `${f} .cfm{display:block;max-width:100%;max-height:100%;object-fit:contain}`,
    // the engine gives its own faces a small-caps accent title and a white contact box; a custom face starts without them
    `${f} .t1{font-size:inherit;letter-spacing:normal;text-transform:none;color:inherit;font-weight:inherit}`,
    `${f} .cl{background:none;border-radius:0;overflow:visible;color:inherit}`,
  ].join("\n");
}

export interface CustomFront {
  /** The whole front face element, ready to replace the engine's. */
  html: string;
  /** The `<style>` element with the face's CSS (add it once per page). */
  style: string;
  /** The face places the company logo itself. */
  ownLogo: boolean;
  hash: string;
}

/** The front of a card drawn with a custom face. */
export function customFront(face: CustomFaceData, input: EngineInput, brand: CompanyBrand | null | undefined): CustomFront {
  const clean = cleanFace(face, ownMedia(brand));
  const values = placeholderValues(input, brand);
  const body = fillTemplate(clean.template, values, input);
  const html = `<div class="face d0 cf-${face.id} tv0"><div class="fx"></div>${body}</div>`;
  const css = `${baseCss(face.id)}\n${clean.css}`;
  const style = `<style data-cf="${esc(face.hash)}">${css}</style>`;
  return { html, style, ownLogo: usesLogo(clean.template), hash: face.hash };
}

/** Put a custom front in place of the front face of the engine's page. Returns the page unchanged when the markup is not found. */
export function swapFront(html: string, front: string): string {
  const start = html.indexOf('<div class="face d');
  const back = html.indexOf('<div class="face back">');
  if (start < 0 || back < 0 || back < start) return html;
  return html.slice(0, start) + front + html.slice(back);
}

/**
 * Keep the style element of each custom face once per page: a later copy with the same hash is dropped.
 * `seen` is shared by all the cards of one page.
 */
export function onceStyles(html: string, seen: Set<string>): string {
  return html.replace(/<style data-cf="([^"]*)">[\s\S]*?<\/style>/g, (whole, hash: string) => {
    if (seen.has(hash)) return "";
    seen.add(hash);
    return whole;
  });
}
