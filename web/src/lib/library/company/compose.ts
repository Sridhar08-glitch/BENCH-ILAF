// Lays the company brand on a card page the engine has drawn: logo on the front and the QR back, logo above the card,
// background with its colour layer, logo pattern, or a company template with the employee's details laid on it.
// Works on the markup string (no DOM), so the public page draws it on the server and the first bytes are already right.
// The browser (see enhance.ts) may refine what needs measuring: the corner a face leaves free and where a background shows.
import {
  BG_IDS, PAGE_PATTERN_LAYER, PATTERN_LAYER, TEMPLATE_SAMPLES, TEXT_SIZE, ZONES, backgroundVars, patternLook, patternVars, plainBackUri, sampleBgUri, scrimFor, templateInfo, templateUri,
  type Scrim,
} from "./artwork";
import { defaultArtwork, sampleColours } from "./brand";
import { WHITE, type CompanyPalette } from "./colour";
import {
  backPlacement, headerHtml, markOf, monogramMark, overlayHtml, place, plan, resolveSpec, specData, specList, type Mark, type MarkSources,
} from "./marks";
import type { CompanyBrand, EngineInput, EngineResult } from "../types";

export interface Composed {
  html: string;
  pageVars: Record<string, string>;
  /** Classes for the `.cfl` wrapper. */
  wrapClass: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A picture address inside url("...") inside a style attribute. */
const cssUrl = (u: string) => esc(u.replace(/"/g, "%22").replace(/\\/g, "%5C"));

/** The marks the company has, with the measured shape when it is known. */
export function markSources(b: CompanyBrand, prim: string, acc: string): MarkSources {
  const info = b.info ?? {};
  const make = (u: string | null | undefined, m: typeof info.logo): Mark | null => (u ? (m ? markOf(m) : { src: u, asp: 2.2, col: "#222222", pal: null }) : null);
  return {
    logo: make(b.logoUrl, info.logo),
    symbol: make(b.symbolUrl, info.symbol),
    mono: monogramMark(b.companyName, prim, acc),
    display: b.logoDisplay ?? "auto",
    showName: b.showName !== false,
    name: b.companyName,
  };
}

/** The address of the mark that the pattern repeats (its compact mark), or null when it is the monogram. */
export function patternMarkUrl(b: CompanyBrand): string | null {
  const { prim, acc } = sampleColours(b.colours);
  const m = resolveSpec(markSources(b, prim, acc), "tight").mark;
  return m.mono ? null : m.src;
}

const ICON = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
};
const ico = (p: string) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

function qrSvg(qr: { size: number; d: string }): string {
  return `<svg viewBox="0 0 ${qr.size} ${qr.size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${qr.size}" height="${qr.size}" fill="#fff"/><path d="${qr.d}" fill="#0B0B0B"/></svg>`;
}

interface Tpl {
  front: string;
  back: string;
}

/** The template's front and back pictures (sample or uploaded), or null when none is chosen or the upload is missing. */
function templateSources(b: CompanyBrand, pal: CompanyPalette): Tpl | null {
  const t = (b.artwork ?? defaultArtwork()).template;
  if (t.kind === "sample" && t.sample && TEMPLATE_SAMPLES.some((s) => s.id === t.sample)) return { front: templateUri(t.sample, "front"), back: templateUri(t.sample, "back") };
  if (t.kind === "upload" && b.templateFrontUrl) return { front: b.templateFrontUrl, back: b.templateBackUrl || plainBackUri(pal) };
  return null;
}

/** The template card: front and QR back drawn from the pictures with the employee's details in the chosen zone. */
function templateFaces(input: EngineInput, b: CompanyBrand, src: Tpl): string {
  const art = b.artwork ?? defaultArtwork();
  const t = art.template;
  const pr = ZONES[t.zone];
  const info = templateInfo(t.zone, t.text_colour, b.info?.front, b.info?.back);
  const custom = /^#[0-9a-f]{6}$/i.test(t.text_colour);
  const fg = custom ? t.text_colour : info.light ? WHITE : "#101114";
  const p = input.person;
  const pos = (o: { x: number; y?: number; b?: number }, more = "") => `left:${o.x}cqw;${o.y != null ? `top:${o.y}cqw;` : `bottom:${o.b}cqw;`}${more}`;
  const flex = (al: string) => (al === "left" ? "flex-start" : al === "right" ? "flex-end" : "center");
  const kind = (ks: string[]) => input.items.find((i) => ks.includes(i.kind));
  const phone = kind(["Mobile", "Landline", "WhatsApp"]);
  const mail = kind(["Email"]);
  const web = kind(["Website"]);
  const line = (p2: string, i: { value: string } | undefined) => (i && i.value ? `<div class="ln">${ico(p2)}<b>${esc(i.value)}</b></div>` : "");
  const panel = (on: boolean) => (on ? ` pn ${info.light ? "pd" : "pl"}` : "");
  const photo = input.design.photo && p.photoUrl ? `<img class="pic" alt="" src="${esc(p.photoUrl)}">` : `<span class="pic">${esc(p.initials)}</span>`;
  let h = `<div class="face tpf" style="--tpfg:${fg};--tsz:${TEXT_SIZE[t.text_size]};background-image:url(&quot;${cssUrl(src.front)}&quot;);">`;
  if (pr.band) h += `<div class="tzband" style="top:${pr.band}cqw;background:${info.light ? "rgba(11,13,18,.74)" : "rgba(255,255,255,.78)"}"></div>`;
  h += `<div class="tzp" style="left:${pr.ph.x}cqw;top:${pr.ph.y}cqw;width:${pr.ph.s}cqw;height:${pr.ph.s}cqw">${photo}</div>`;
  h += `<div class="tzt${panel(info.pn[0])}" style="left:${pr.tx.x}cqw;top:${pr.tx.y}cqw;width:${pr.tx.w}cqw;text-align:${pr.tx.al};align-items:${flex(pr.tx.al)}"><div class="n">${esc(p.name)}</div><div class="t1">${esc(p.title)}</div></div>`;
  h += `<div class="tzc${panel(info.pn[1])}" style="${pos(pr.ct, `width:${pr.ct.w}cqw;align-items:${flex(pr.ct.al)}`)}">${line(ICON.phone, phone)}${line(ICON.mail, mail)}${line(ICON.web, web)}</div>`;
  if (pr.qr) h += `<div class="tzq" style="${pos(pr.qr, `width:${pr.qr.s}cqw;height:${pr.qr.s}cqw`)}">${qrSvg(input.qr)}</div>`;
  h += "</div>";
  h += `<div class="face back tpb" style="--tpfg:${info.backFg};background-image:url(&quot;${cssUrl(src.back)}&quot;);"><div class="qrt">${qrSvg(input.qr)}</div><div class="bk1" style="color:${info.backFg}">Scan to save my contact</div></div>`;
  return h;
}

/** Cut the template's faces in place of the engine's own front and back. */
function swapFaces(html: string, faces: string): string {
  const start = html.indexOf('<div class="face d');
  const backStart = html.indexOf('<div class="face back">');
  const bk2 = html.indexOf('<div class="bk2">', backStart);
  if (start < 0 || backStart < 0 || bk2 < 0) return html;
  const afterBk2 = html.indexOf("</div>", bk2) + 6;
  const end = html.indexOf("</div>", afterBk2) + 6;
  return html.slice(0, start) + faces + html.slice(end);
}

const NO_SCRIPT_HEAD = "<noscript><style>.cfl .cohead[hidden]{display:flex!important}</style></noscript>";

/** The engine's card page with the company brand laid on it. Without a company the page is returned as it is. */
export function composeCompany(out: EngineResult, input: EngineInput, brand: CompanyBrand, thumb = false, opts: { customLogo?: boolean } = {}): Composed {
  const pal = { bg: out.cardVars.bg, bg2: out.cardVars.bg2, fg: out.cardVars.fg, acc: out.cardVars.acc, on: out.cardVars.on };
  const art = brand.artwork ?? defaultArtwork();
  const info = brand.info ?? {};
  const { prim, acc } = sampleColours(brand.colours);
  const marks = markSources(brand, prim, acc);
  const own = [prim, pal.acc, pal.fg];
  const pref = brand.logoCorner ?? "auto";
  const setting = brand.logoChip ?? "auto";
  const placement = brand.logoPlacement ?? "both";
  let html = out.html;
  const vars: Record<string, string> = {};
  const cls = ["co"];

  const tpl = art.mode === "template" ? templateSources(brand, pal) : null;

  // background picture and its colour layer
  let scrim: Scrim | null = null;
  const bgOn = art.mode === "background" || (art.mode === "pattern" && art.pattern.combine_with_background);
  let bgImage: string | null = null;
  if (bgOn && !tpl) {
    const b = art.background;
    if (b.kind === "sample" && b.sample && BG_IDS.includes(b.sample)) bgImage = sampleBgUri(b.sample, prim, acc);
    else if (b.kind === "upload" && brand.backgroundUrl) bgImage = brand.backgroundUrl;
  }
  if (bgImage) {
    scrim = scrimFor(pal, info.bg, art.background.strength);
    Object.assign(vars, backgroundVars(pal, bgImage, scrim));
    cls.push("cobgp");
  }

  // the logo pattern
  let pattern = false;
  if (art.mode === "pattern" && !tpl) {
    const m = resolveSpec(marks, "tight").mark;
    const pm = m.mono ? { u: m.src, blob: false } : info.pat;
    if (pm) {
      Object.assign(vars, patternVars(patternLook(art.pattern, pm, m.asp, pal)));
      cls.push("copg");
      pattern = true;
    }
  }

  const fallbackBgs = scrim ? [scrim.surface] : [pal.bg, pal.bg2];
  if (tpl) {
    html = swapFaces(html, templateFaces(input, brand, tpl));
    cls.push("cotpl");
  } else {
    if (pattern) {
      html = html.replace('</div><div class="face back">', () => PATTERN_LAYER + '</div><div class="face back">').replace('<div class="qrt">', () => PATTERN_LAYER + '<div class="qrt">');
    }
    if (placement !== "above") {
      const specs = specList(marks);
      const pl = plan(specs, (s) => place({ spec: s, pref, setting, obstacles: null, bgsAt: null, own, fallbackBgs }));
      const extra = ` data-co="front" data-specs="${specData(specs)}" data-pref="${pref}" data-chip="${setting}" data-own="${own.join(",")}" data-alt="${esc(brand.companyName)}"${scrim ? ` data-surf="${scrim.surface}" data-bg="${pal.bg}"` : ""}`;
      // In automatic mode the corner is chosen in the browser from the real face. Until then the mark is not drawn on the
      // card (the one above the card is shown instead, also without scripts), so it can never cover a name.
      const wait = pref === "auto" && !thumb;
      // A custom face that places the company logo itself gets no automatic corner logo on its front.
      const front = opts.customLogo ? "" : overlayHtml(pl, brand.companyName, extra + (wait ? " hidden" : ""));
      const bp = backPlacement(resolveSpec(marks, "tight"), setting, fallbackBgs);
      const back = overlayHtml(bp, brand.companyName, ' data-co="back"');
      html = html.replace('</div><div class="face back">', () => front + '</div><div class="face back">').replace('<div class="qrt">', () => back + '<div class="qrt">');
    }
  }
  // the background goes on last: the layers above are placed by the plain face markup
  if (bgImage && !tpl) html = html.replace('<div class="face d', '<div class="face cobg d').replace('<div class="face back">', '<div class="face back cobg">');
  if (pattern) html = PAGE_PATTERN_LAYER + html;

  // the mark above the card: shown for "above" and "both"; kept hidden for "card" so the browser can show it when no corner is clean
  if (!thumb) {
    const head = headerHtml(resolveSpec(marks, "card"), setting, scrim ? scrim.surface : pal.bg2, brand.companyName, own, placement === "card" || !!opts.customLogo);
    html = html.replace('<div class="pg ls-rise">', () => '<div class="pg ls-rise">' + head);
  }

  // Without scripts the mark above the card is always shown, even when the owner wants it on the card only.
  if (!thumb && placement !== "above" && !tpl && pref === "auto" && !opts.customLogo) html += NO_SCRIPT_HEAD;

  return { html, pageVars: { ...out.pageVars, ...vars }, wrapClass: cls.join(" ") };
}

