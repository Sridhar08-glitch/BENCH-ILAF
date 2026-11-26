// Which company mark a card shows (full logo, symbol, symbol with the company name, or a monogram) and where it goes.
// Pure decisions, the same on the server (first draw) and in the browser (measured refinement).
import { WHITE, cr } from "./colour";
import type { MarkInfo } from "../types";
import type { LogoChip, LogoCorner, LogoDisplay } from "@/lib/types";

/** A card is 100 wide and 100 * 4 / 7 high in card-width units (cqw). */
export const FACE_H = (100 * 4) / 7;
/** Space between a mark and the card edge, and padding inside a chip. */
export const MARGIN = 3.2;
export const PAD = 1.1;

export type Corner = "tl" | "tr" | "bl" | "br";
/** One rectangle [left, top, right, bottom] in card-width units. */
export type Box = [number, number, number, number];

/** A picture drawn as a mark. */
export interface Mark {
  src: string;
  /** Width divided by height. */
  asp: number;
  /** Average colour. */
  col: string;
  /** Main colours with their share, or null when unknown. */
  pal: [string, number][] | null;
  /** True for the monogram made from the initials. */
  mono?: boolean;
}

/** A mark with the choice of showing the company name beside it. */
export interface Spec {
  mark: Mark;
  name: string | null;
  /** Width divided by height of the whole lock-up. */
  asp: number;
  col: string;
}

export const markOf = (m: MarkInfo): Mark => ({ src: m.url, asp: m.asp, col: m.col, pal: m.pal.length ? m.pal : null });

/** Width and height (card-width units) a mark of this shape may use on a card: wide marks get a wide, low box. */
export function shapeBox(a: number): { h: number; w: number } {
  return a >= 4.5 ? { h: 6.4, w: 32 } : a >= 2.2 ? { h: 7.6, w: 28 } : a >= 1.35 ? { h: 8.6, w: 18 } : a >= 0.75 ? { h: 9.4, w: 11.5 } : a >= 0.45 ? { h: 13, w: 10 } : { h: 16, w: 8 };
}

/** A mark close to square counts as a symbol. */
export const isSym = (m: { asp: number } | null | undefined): boolean => !!m && m.asp >= 0.75 && m.asp <= 1.35;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const svgUri = (inner: string, w: number, h: number) =>
  "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${inner}</svg>`);

/** A square monogram from the company's initials in the brand colours, for a company that has no logo yet. */
export function monogramMark(name: string, prim: string, acc: string): Mark {
  const ws = name.replace(/&/g, " ").split(/\s+/).filter((w) => w && !/^(and|the|of)$/i.test(w));
  const ini = ((ws[0] || "C").charAt(0) + (ws.length > 1 ? ws[ws.length - 1].charAt(0) : "")).toUpperCase();
  const tc = cr("#FFFFFF", prim) >= cr("#111111", prim) ? "#FFFFFF" : "#111111";
  const src = svgUri(
    `<rect x="2" y="2" width="60" height="60" rx="16" fill="${prim}"/><rect x="3.5" y="3.5" width="57" height="57" rx="14.5" fill="none" stroke="${acc}" stroke-width="3"/><rect x="19" y="47" width="26" height="3.4" rx="1.7" fill="${acc}"/><text x="32" y="${ini.length > 1 ? 38 : 41}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="${ini.length > 1 ? 25 : 32}" fill="${tc}">${esc(ini)}</text>`,
    64, 64,
  );
  return { src, asp: 1, col: prim, pal: [[prim, 1]], mono: true };
}

/** Split a long company name into two lines of about the same length. */
export function nameLines(n: string): string[] {
  const t = (n || "").trim();
  if (t.length > 11 && t.indexOf(" ") > 0) {
    const w = t.split(/\s+/);
    let best = 1;
    let bd = 1e9;
    for (let i = 1; i < w.length; i++) {
      const a = w.slice(0, i).join(" ").length;
      const b = w.slice(i).join(" ").length;
      if (Math.abs(a - b) < bd) {
        bd = Math.abs(a - b);
        best = i;
      }
    }
    return [w.slice(0, best).join(" "), w.slice(best).join(" ")];
  }
  return [t];
}

/** Width of a bold line of text divided by its font size (an estimate that needs no fonts, so it runs anywhere). */
export function textRatio(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (/[ilj.,:;!|'`]/.test(ch)) w += 0.3;
    else if (ch === " ") w += 0.3;
    else if (/[mwMW@]/.test(ch)) w += 0.95;
    else if (/[A-Z]/.test(ch)) w += 0.74;
    else if (/[0-9]/.test(ch)) w += 0.62;
    else w += 0.6;
  }
  return w;
}

function lockAsp(m: Mark, name: string): number {
  const ls = nameLines(name);
  let mx = 0;
  ls.forEach((l) => (mx = Math.max(mx, textRatio(l))));
  return Math.max(1.8, Math.min(4.4, m.asp + 0.2 + mx * (ls.length > 1 ? 0.34 : 0.46) * 1.04));
}

export const mkSpec = (m: Mark, name: string | null): Spec => ({ mark: m, name: name || null, asp: name ? lockAsp(m, name) : m.asp, col: m.col });

export interface MarkSources {
  logo: Mark | null;
  symbol: Mark | null;
  mono: Mark;
  display: LogoDisplay;
  showName: boolean;
  name: string;
}

/**
 * The mark for a place: "card" is the corner of a card, where a compact mark is wanted when the setting is automatic ("tight").
 * Auto shows the full logo when there is one, else the symbol with the company name, else the monogram.
 */
export function resolveSpec(src: MarkSources, ctx: "card" | "tight"): Spec {
  const full = src.logo;
  const fromFull = !!full && isSym(full) && !src.symbol;
  const asSym = src.symbol || (fromFull ? full : null);
  const asFull = full && !fromFull ? full : null;
  const md = src.display === "symbol" ? "sym" : src.display === "symbol_name" ? "symname" : src.display === "full" ? "full" : "auto";
  const lock = (m: Mark) => mkSpec(m, src.showName ? src.name : null);
  if (ctx === "tight") {
    if (md === "full") return mkSpec(full || asSym || src.mono, null);
    return mkSpec(asSym || (md === "sym" || md === "auto" || md === "symname" ? asFull : null) || src.mono, null);
  }
  if (md === "full") return full ? mkSpec(full, null) : lock(asSym || src.mono);
  if (md === "sym") return mkSpec(asSym || full || src.mono, null);
  // No symbol uploaded: the logo stands in for it. The company's initial letters are only for a company with no picture at all.
  if (md === "symname") return lock(asSym || full || src.mono);
  return asFull ? mkSpec(asFull, null) : lock(asSym || src.mono);
}

/** In automatic mode a full logo may give way to its compact symbol on a face where the full logo does not fit. */
export function specList(src: MarkSources): Spec[] {
  const a = resolveSpec(src, "card");
  const b = resolveSpec(src, "tight");
  const same = a.mark.src === b.mark.src && a.name === b.name;
  return src.display === "auto" && !same ? [a, b] : [a];
}

/** A mark is hard to read when a real share of its pixels is too close to the colour behind it. */
export function weak(sp: Spec, bg: string, mono: string): boolean {
  if (mono) return cr(mono, bg) < 3;
  const pal = sp.mark.pal;
  if (!pal || !pal.length) return cr(sp.col, bg) < 3;
  let s = 0;
  pal.forEach((c) => {
    if (cr(c[0], bg) < 3) s += c[1];
  });
  return s > 0.2;
}

/** The chip behind a mark: white or near black, whichever suits the mark's own colours. */
export function chipBg(sp: Spec, mono: string): string {
  const pal: [string, number][] = mono ? [[mono, 1]] : sp.mark.pal && sp.mark.pal.length ? sp.mark.pal : [[sp.col, 1]];
  let ws = 0;
  let ds = 0;
  let w = 0;
  let d = 0;
  pal.forEach((c) => {
    const cw = cr(c[0], WHITE);
    const cd = cr(c[0], "#0E0E10");
    if (cw >= 3) ws += c[1];
    if (cd >= 3) ds += c[1];
    w += c[1] * cw;
    d += c[1] * cd;
  });
  return ws > ds + 0.001 || (Math.abs(ws - ds) <= 0.001 && w >= d) ? "#FFFFFF" : "#0E0E10";
}

/** The mark's width and height at a scale, in card-width units. */
export function dimsOf(sp: Spec, sc: number): { w: number; h: number } {
  const b = shapeBox(sp.asp);
  let w = Math.min(b.w, b.h * sp.asp);
  let h = w / sp.asp;
  if (h > b.h) {
    h = b.h;
    w = h * sp.asp;
  }
  return { w: w * sc, h: h * sc };
}

export function cornerRect(c: Corner, bw: number, bh: number): Box {
  const x = c.charAt(1) === "r" ? 100 - MARGIN - bw : MARGIN;
  const y = c.charAt(0) === "b" ? FACE_H - MARGIN - bh : MARGIN;
  return [x, y, x + bw, y + bh];
}

export function overlap(a: Box, b: Box): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

export interface Placement {
  spec: Spec;
  c: Corner;
  x: number;
  y: number;
  bw: number;
  bh: number;
  /** Area (card-width units squared) of text and photo the mark still covers. */
  ov: number;
  sc: number;
  /** In automatic mode no corner was clean enough, so the mark goes above the card instead. */
  moved: boolean;
  chip: boolean;
  /** "w" or "k" for a one-colour mark, else "". */
  mono: "" | "w" | "k";
  bgc: string;
  /** Colour of the company name beside a symbol ("" when there is no name). */
  nc: string;
}

const SCALES = [1, 0.84, 0.7, 0.58];

/** The corner order to try: automatic tries the top right first. */
export const cornerOrder = (pref: LogoCorner): Corner[] => (pref === "auto" ? ["tr", "tl", "br", "bl"] : [pref]);

/** The corner and size with the least overlap with the text and photo of a face. */
export function choosePlacement(obstacles: Box[], sp: Spec, pref: LogoCorner, size = 1): { c: Corner; r: Box; w: number; h: number; sc: number; ov: number } {
  const order = cornerOrder(pref);
  let best: { c: Corner; r: Box; w: number; h: number; sc: number; ov: number } | null = null;
  let bo = 1e9;
  for (let si = 0; si < SCALES.length && bo > 0; si++) {
    const d = dimsOf(sp, SCALES[si] * size);
    const bw = d.w + 2 * PAD;
    const bh = d.h + 2 * PAD;
    for (let ci = 0; ci < order.length; ci++) {
      const r = cornerRect(order[ci], bw, bh);
      let o = 0;
      obstacles.forEach((b) => (o += overlap(r, b)));
      if (o < bo - 0.001) {
        bo = o;
        best = { c: order[ci], r, w: d.w, h: d.h, sc: SCALES[si], ov: o };
      }
      if (o === 0) break;
    }
  }
  return best as { c: Corner; r: Box; w: number; h: number; sc: number; ov: number };
}

/** Chip setting names as the API spells them. */
const chipStyle = (c: LogoChip) => (c === "always" ? "chip" : c === "never" ? "none" : c);

/** One-colour or original mark, with a chip when it would not be readable on what is behind it (`bgs` null = unknown). */
export function chipFor(sp: Spec, bgs: (string | null)[] | null, setting: LogoChip): { chip: boolean; mono: "" | "w" | "k"; bgc: string } {
  const st = chipStyle(setting);
  const mono = st === "white" ? "w" : st === "black" ? "k" : "";
  const col = mono === "w" ? WHITE : mono === "k" ? "#000000" : sp.col;
  let need: boolean;
  if (st === "chip") need = true;
  else if (st === "none") need = false;
  else need = !bgs || !bgs.length || bgs.some((b) => !b || weak(sp, b, mono ? col : ""));
  return { chip: need, mono, bgc: need ? chipBg(sp, mono ? col : "") : "" };
}

/** The company name beside a symbol: a brand colour when it reads on what is behind it, otherwise black or white. */
export function nameColour(cf: { chip: boolean; mono: "" | "w" | "k"; bgc: string }, bgs: (string | null)[] | null, own: string[]): string {
  if (cf.mono && !cf.chip) return cf.mono === "w" ? WHITE : "#000000";
  const lst = cf.chip ? [cf.bgc] : (bgs || []).filter((b): b is string => !!b);
  const cands = [...own, "#111111", "#FFFFFF"];
  if (!lst.length) return "#111111";
  let best = "#111111";
  let bm = -1;
  for (const c of cands) {
    let m = 99;
    lst.forEach((b) => (m = Math.min(m, cr(c, b))));
    if (m >= 4.5) return c;
    if (m > bm) {
      bm = m;
      best = c;
    }
  }
  return best;
}

export interface PlaceInput {
  spec: Spec;
  pref: LogoCorner;
  setting: LogoChip;
  /** Text and photo boxes of the face; null when the face was not measured (first draw on the server). */
  obstacles: Box[] | null;
  /** Colours behind the mark at a few points; null when unknown. */
  bgsAt: ((r: Box) => (string | null)[] | null) | null;
  /** Colours the name may take besides black and white. */
  own: string[];
  /** The colour behind the mark when nothing was measured (the card's own colours). */
  fallbackBgs: string[];
  /** The corner to try first when the face was not measured. */
  guess?: Corner;
  /** How large the owner wants the logo, as a share of its automatic size (0.5 to 1.5). */
  size?: number;
}

/** Decide where one mark goes on the front of a card and how it is drawn. */
export function place(i: PlaceInput): Placement {
  let c: Corner;
  let r: Box;
  let w: number;
  let h: number;
  let sc: number;
  let ov: number;
  if (i.obstacles) {
    const b = choosePlacement(i.obstacles, i.spec, i.pref, i.size ?? 1);
    ({ c, r, w, h, sc, ov } = b);
  } else {
    c = i.pref === "auto" ? i.guess || "tr" : i.pref;
    const d = dimsOf(i.spec, 0.84 * (i.size ?? 1));
    w = d.w;
    h = d.h;
    sc = 0.84;
    ov = 0;
    r = cornerRect(c, w + 2 * PAD, h + 2 * PAD);
  }
  // Measured colours win; "null" from a measurement means the area is decorated and cannot be read as a flat colour (a chip is used).
  const bgs = i.setting === "always" || i.setting === "never" ? null : i.bgsAt ? i.bgsAt(r) : i.fallbackBgs;
  const cf = chipFor(i.spec, bgs, i.setting);
  return {
    spec: i.spec, c, x: r[0], y: r[1], bw: r[2] - r[0], bh: r[3] - r[1], ov, sc,
    moved: !!i.obstacles && ov > 3 && i.pref === "auto",
    chip: cf.chip, mono: cf.mono, bgc: cf.bgc,
    nc: i.spec.name ? nameColour(cf, bgs, i.own) : "",
  };
}

/** The best of several marks for a face: the first that fits cleanly at a good size, else the least overlap. */
export function plan(specs: Spec[], make: (s: Spec) => Placement): Placement {
  let best: Placement | null = null;
  for (const s of specs) {
    const pl = make(s);
    if (pl.ov < 0.001 && pl.sc >= 0.7) return pl;
    if (!best || pl.ov < best.ov - 0.001) best = pl;
  }
  return best as Placement;
}

/** On the QR back: a compact mark at the top right, a wide one centred above the code. */
export function backPlacement(sp: Spec, setting: LogoChip, bgs: string[]): Placement {
  const compact = sp.asp < 1.8;
  const sb = shapeBox(sp.asp);
  const h0 = compact ? Math.min(sb.h, 11) : Math.min(sb.h, 4.9);
  const w0 = compact ? sb.w : Math.min(sb.w, 26);
  let w = Math.min(w0, h0 * sp.asp);
  let h = w / sp.asp;
  if (h > h0) {
    h = h0;
    w = h * sp.asp;
  }
  const cf = chipFor(sp, bgs, setting);
  const bw = w + 2 * PAD;
  const bh = h + 2 * PAD;
  return { spec: sp, c: "tr", x: compact ? 100 - MARGIN - bw : (100 - bw) / 2, y: compact ? MARGIN : 2.6, bw, bh, ov: 0, sc: 1, moved: false, chip: cf.chip, mono: cf.mono, bgc: cf.bgc, nc: "" };
}

/** The mark laid on a card face (or the QR back), as markup. `data-spec` lets the browser measure the real face and redo the choice. */
export function overlayHtml(pl: Placement, alt: string, extra = ""): string {
  const sp = pl.spec;
  const chip = pl.chip;
  const bw = pl.bw - (chip ? 0 : 2 * PAD);
  const bh = pl.bh - (chip ? 0 : 2 * PAD);
  const ch = pl.bh - 2 * PAD;
  let st = `left:${(pl.x + (chip ? 0 : PAD)).toFixed(2)}cqw;top:${(pl.y + (chip ? 0 : PAD)).toFixed(2)}cqw;width:${bw.toFixed(2)}cqw;height:${bh.toFixed(2)}cqw;`;
  if (chip) st += `background:${pl.bgc};padding:${PAD}cqw;`;
  const cls = `colg${chip ? " chip" : ""}${pl.mono ? " " + pl.mono : ""}${sp.name ? " lk" : ""}`;
  let inner: string;
  if (sp.name) {
    const ls = nameLines(sp.name);
    const th = ls.length > 1 ? 0.34 : 0.46;
    inner = `<img alt="" src="${esc(sp.mark.src)}" style="aspect-ratio:${sp.mark.asp.toFixed(3)}"><span class="cn" style="font-size:${(ch * th).toFixed(2)}cqw;color:${pl.nc};margin-left:${(ch * 0.2).toFixed(2)}cqw">${ls.map(esc).join("<br>")}</span>`;
  } else inner = `<img alt="${esc(alt)} logo" src="${esc(sp.mark.src)}">`;
  return `<div class="${cls}" style="${st}" data-c="${pl.c}"${extra}>${inner}</div>`;
}

/** The mark above the card, on the page colour. Sizes are in pixels (the page is phone width). */
/**
 * The logo where the owner put it on this design: left, top and width in percent of the card face. The mark alone is drawn
 * (no company name beside it), on a plate when it would not be readable on the card colours.
 */
export function freeOverlayHtml(sp: Spec, spot: { x: number; y: number; w: number }, setting: LogoChip, bgs: string[], alt: string, extra = ""): string {
  const cf = chipFor(sp, bgs, setting);
  const pad = cf.chip ? ` padding:1.1cqw;background:${cf.bgc};` : "";
  const cls = `colg${cf.chip ? " chip" : ""}${cf.mono ? " " + cf.mono : ""}`;
  const st = `left:${spot.x.toFixed(1)}%;top:${spot.y.toFixed(1)}%;width:${spot.w.toFixed(1)}%;height:auto;aspect-ratio:${sp.mark.asp.toFixed(3)};${pad}`;
  return `<div class="${cls}" style="${st}" data-c="free"${extra}><img alt="${esc(alt)} logo" src="${esc(sp.mark.src)}"></div>`;
}

export function headerHtml(sp: Spec, setting: LogoChip, pageBg: string, alt: string, own: string[], hidden = false, size = 1): string {
  const st = chipStyle(setting);
  const mono = st === "white" ? "w" : st === "black" ? "k" : "";
  const col = mono === "w" ? WHITE : mono === "k" ? "#000000" : sp.col;
  const chip = st === "chip" || (st !== "none" && weak(sp, pageBg, mono ? col : ""));
  const bgc = chip ? chipBg(sp, mono ? col : "") : "";
  const a = sp.asp;
  const mw = (sp.name ? 200 : 190) * size;
  let h = (sp.name ? 30 : a >= 4.5 ? 20 : a >= 2.2 ? 28 : a >= 1.35 ? 34 : a >= 0.75 ? 36 : 46) * size;
  let w = h * a;
  if (w > mw) {
    w = mw;
    h = w / a;
  }
  const m = sp.mark;
  let inner: string;
  if (sp.name) {
    const ls = nameLines(sp.name);
    const th = ls.length > 1 ? 0.34 : 0.46;
    const nc = nameColour({ chip, bgc, mono: chip ? "" : (mono as "" | "w" | "k") }, [pageBg], own);
    inner = `<img alt="" src="${esc(m.src)}" style="height:${h.toFixed(1)}px;width:${(h * m.asp).toFixed(1)}px;max-width:none"><span class="cn" style="font-size:${(h * th).toFixed(1)}px;color:${nc};margin-left:${(h * 0.2).toFixed(1)}px">${ls.map(esc).join("<br>")}</span>`;
  } else inner = `<img alt="${esc(alt)} logo" src="${esc(m.src)}" style="height:${h.toFixed(1)}px;width:${w.toFixed(1)}px;max-width:none">`;
  return `<div class="cohead"${hidden ? ' hidden data-auto="1"' : ""}><span class="lgw colg${mono ? " " + mono : ""}${sp.name ? " lk" : ""}" style="position:static;${chip ? `background:${bgc};` : "padding:0;"}">${inner}</span></div>`;
}

/** Serialised specs for the browser, which measures the real card and may choose again. */
export function specData(specs: Spec[]): string {
  return esc(JSON.stringify(specs.map((s) => ({ s: s.mark.src, a: s.mark.asp, c: s.col, p: s.mark.pal, n: s.name, k: s.asp }))));
}

export function specsFromData(json: string): Spec[] {
  const arr = JSON.parse(json) as { s: string; a: number; c: string; p: [string, number][] | null; n: string | null; k: number }[];
  return arr.map((x) => ({ mark: { src: x.s, asp: x.a, col: x.c, pal: x.p }, name: x.n, asp: x.k, col: x.c }));
}

