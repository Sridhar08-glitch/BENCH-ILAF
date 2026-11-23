// Company artwork: sample backgrounds drawn from the brand colours, the colour layer that keeps text readable over a
// picture, the repeating logo pattern, and the company template (a finished card design with the details laid on it).
// Pure functions: every measurement they need (how light a picture is) is passed in, so the server and the browser agree.
import { WHITE, cr, mix, rgba, rl, h2r, r2h, type CompanyPalette } from "./colour";
import { FACE_H } from "./marks";
import type { ArtStats, PatternMark } from "../types";
import type { BrandArtwork, TemplateZone } from "@/lib/types";

/** A data address that holds an SVG picture (safe inside url("...")). */
export function svgUri(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

// ---- sample backgrounds

export const BG_SAMPLES = [
  { id: "geo", name: "Geometric" },
  { id: "mesh", name: "Gradient mesh" },
  { id: "photo", name: "Abstract photo" },
  { id: "stripes", name: "Diagonal stripes" },
  { id: "dots", name: "Dotted grid" },
  { id: "topo", name: "Topographic" },
] as const;

export const BG_IDS: string[] = BG_SAMPLES.map((b) => b.id);

const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** One of the six sample backgrounds as SVG text, drawn from the two brand colours. */
export function sampleBgSvg(id: string, prim: string, acc: string): string {
  const dk = mix(prim, "#000000", 0.38);
  const lt = mix(acc, "#FFFFFF", 0.35);
  const pl = mix(prim, "#FFFFFF", 0.22);
  let s = "";
  if (id === "geo") {
    s = `<rect width="1400" height="800" fill="${prim}"/>`;
    const cols = [dk, pl, acc, lt, prim];
    let cnt = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 14; x++) {
        const X = x * 100;
        const Y = y * 100;
        const r1 = rnd(cnt++);
        const r2 = rnd(cnt++);
        s += `<polygon points="${X},${Y} ${X + 100},${Y} ${X},${Y + 100}" fill="${cols[Math.floor(r1 * 5)]}" fill-opacity="${(0.18 + r1 * 0.3).toFixed(2)}"/><polygon points="${X + 100},${Y} ${X + 100},${Y + 100} ${X},${Y + 100}" fill="${cols[Math.floor(r2 * 5)]}" fill-opacity="${(0.12 + r2 * 0.3).toFixed(2)}"/>`;
      }
    }
  } else if (id === "mesh") {
    s = `<defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="95"/></filter></defs><rect width="1400" height="800" fill="${prim}"/><g filter="url(#b)"><circle cx="230" cy="190" r="270" fill="${acc}" fill-opacity=".85"/><circle cx="1130" cy="140" r="300" fill="${lt}" fill-opacity=".7"/><circle cx="700" cy="690" r="340" fill="${dk}"/><circle cx="1260" cy="690" r="250" fill="${acc}" fill-opacity=".6"/><circle cx="120" cy="720" r="230" fill="${pl}" fill-opacity=".8"/></g>`;
  } else if (id === "stripes") {
    s = `<defs><pattern id="s" width="64" height="64" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="64" height="64" fill="${prim}"/><rect width="30" height="64" fill="${dk}" fill-opacity=".6"/><rect x="38" width="4" height="64" fill="${acc}" fill-opacity=".8"/></pattern></defs><rect width="1400" height="800" fill="url(#s)"/>`;
  } else if (id === "dots") {
    s = `<defs><pattern id="d" width="44" height="44" patternUnits="userSpaceOnUse"><rect width="44" height="44" fill="${prim}"/><circle cx="22" cy="22" r="4.5" fill="${lt}" fill-opacity=".42"/></pattern><pattern id="e" width="176" height="176" patternUnits="userSpaceOnUse"><circle cx="22" cy="22" r="9" fill="${acc}" fill-opacity=".85"/></pattern></defs><rect width="1400" height="800" fill="${dk}"/><rect width="1400" height="800" fill="url(#d)"/><rect width="1400" height="800" fill="url(#e)"/>`;
  } else if (id === "topo") {
    s = `<rect width="1400" height="800" fill="${prim}"/>`;
    for (let i = 0; i < 17; i++) {
      let d = `M0 ${(i * 52).toFixed(0)}`;
      for (let x = 0; x <= 1400; x += 35) {
        const y = i * 52 + Math.sin(x / 170 + i * 0.55) * 38 + Math.sin(x / 61 + i) * 11;
        d += ` L${x} ${y.toFixed(1)}`;
      }
      s += `<path d="${d}" fill="none" stroke="${i % 5 === 0 ? acc : lt}" stroke-opacity="${i % 5 === 0 ? 0.55 : 0.24}" stroke-width="${i % 5 === 0 ? 3.2 : 2}"/>`;
    }
  } else {
    // "photo": soft light and shapes in the brand colours
    s = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${acc}"/><stop offset="1" stop-color="${prim}"/></linearGradient></defs><rect width="1400" height="800" fill="url(#g)"/><circle cx="1120" cy="170" r="400" fill="${lt}" opacity=".18"/><circle cx="200" cy="740" r="300" fill="${dk}" opacity=".3"/><path d="M0 560C260 450 520 700 800 580S1200 470 1400 560V800H0z" fill="${dk}" opacity=".28"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 800" preserveAspectRatio="xMidYMid slice" width="1400" height="800">${s}</svg>`;
}

export const sampleBgUri = (id: string, prim: string, acc: string) => svgUri(sampleBgSvg(id, prim, acc));

// ---- the colour layer over a picture

/** The smallest colour layer (0 to 1) that keeps text 4.5 : 1 and accent 3 : 1 over the worst spot of the picture. */
export function minAlpha(fg: string, acc: string, bg: string, worst: string): number {
  for (let a = 0; a <= 1.0001; a += 0.02) {
    const c = mix(worst, bg, a);
    if (cr(fg, c) >= 4.5 && cr(acc, c) >= 3) return Math.min(1, a);
  }
  return 1;
}

export interface Scrim {
  /** Colour layer over the card face, the second card colour and the thin edge. */
  a: number;
  a2: number;
  edge: number;
  /** The colour layer was raised above what the owner asked for because the picture is busy under the text. */
  raised: boolean;
  /** Contrast of text and accent over the worst spot after the layer. */
  text: number;
  acc: number;
  /** Colour a mark sees on top of the layered picture. */
  surface: string;
}

/**
 * The colour layer for a picture. `strength` is how much picture the owner wants (0 plain colour, 100 as strong as stays readable).
 * A picture that was not measured gets a strong layer, so text is readable whatever the picture turns out to be.
 */
export function scrimFor(pal: CompanyPalette, stats: ArtStats | null | undefined, strength: number): Scrim {
  const au = 1 - (strength / 100) * 0.95;
  if (!stats) {
    const a = Math.max(0.86, au);
    return { a, a2: a, edge: Math.max(0.1, a * 0.35), raised: false, text: cr(pal.fg, pal.bg), acc: cr(pal.acc, pal.bg), surface: pal.bg };
  }
  const light = rl(pal.fg) > 0.4;
  const worst = light ? stats.p92 : stats.p8;
  const am = minAlpha(pal.fg, pal.acc, pal.bg, worst);
  const am2 = minAlpha(pal.fg, pal.acc, pal.bg2, worst);
  const a = Math.max(am, au);
  const a2 = Math.max(am2, au);
  const sf = mix(worst, pal.bg, a);
  return { a, a2, edge: Math.max(0.1, a * 0.35), raised: am > au + 0.01, text: cr(pal.fg, sf), acc: cr(pal.acc, sf), surface: mix(stats.avg, pal.bg, a) };
}

/** Style variables of the background layer (set on the page wrapper; the face, back and page below read them). */
export function backgroundVars(pal: CompanyPalette, imageUrl: string, sc: Scrim): Record<string, string> {
  return {
    "--cobgimg": `url("${imageUrl.replace(/"/g, "%22")}")`,
    "--cosc": rgba(pal.bg, sc.a),
    "--cosc2": rgba(pal.bg2, sc.a2),
    "--coscb": rgba(pal.bg, sc.edge),
  };
}

// ---- logo pattern

const SIZE_PCT = { s: 10, m: 16, l: 26 } as const;
const GAP_MULT = { tight: 2.5, normal: 3.3, wide: 4.6 } as const;

export interface PatternLook {
  tile: string;
  width: string;
  angle: number;
  opacity: number;
  filter: string;
  /** Contrast of text against the card colour tinted by the pattern at full strength. */
  ratio: number;
}

/** The repeating pattern of one mark: a tile with two staggered copies, size, angle, opacity and the one-colour filter. */
export function patternLook(p: BrandArtwork["pattern"], mark: PatternMark, asp: number, pal: CompanyPalette): PatternLook {
  const lwp = SIZE_PCT[p.size];
  const mult = GAP_MULT[p.spacing];
  let lw = 64;
  let lh = Math.max(10, lw / asp);
  let tw = lw * mult;
  let th = Math.max(lh * mult, lw * 0.34 * mult);
  if (asp < 1) {
    lh = 64;
    lw = Math.max(10, lh * asp);
    tw = lw * mult * 1.4;
    th = lh * mult;
  }
  const img = (cx: number, cy: number) => `<image href="${mark.u.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" x="${(cx - lw / 2).toFixed(1)}" y="${(cy - lh / 2).toFixed(1)}" width="${lw.toFixed(1)}" height="${lh.toFixed(1)}"/>`;
  const tile = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${tw.toFixed(1)}" height="${th.toFixed(1)}" viewBox="0 0 ${tw.toFixed(1)} ${th.toFixed(1)}">${img(tw * 0.25, th * 0.25)}${img(tw * 0.75, th * 0.75)}</svg>`);
  const dark = rl(pal.bg) < 0.4;
  const filter = mark.blob ? (dark ? "grayscale(1) brightness(1.7)" : "grayscale(1) brightness(.55)") : dark ? "brightness(0) invert(1)" : "brightness(0)";
  const logoPct = asp >= 1 ? lwp : lwp * 0.8 * asp;
  const op = p.opacity / 100;
  return {
    tile, width: ((logoPct * (tw / lw)) / 2.2).toFixed(2) + "%", angle: p.angle, opacity: op, filter,
    ratio: cr(pal.fg, mix(pal.bg, dark ? "#FFFFFF" : "#000000", op * 0.55)),
  };
}

export function patternVars(l: PatternLook): Record<string, string> {
  return { "--copat": `url("${l.tile}")`, "--copw": l.width, "--copang": `${l.angle}deg`, "--copop": String(l.opacity), "--copf": l.filter };
}

/** The pattern layer markup (it sits above a face, the QR back and the page, below the text). */
export const PATTERN_LAYER = '<div class="copatw"><div class="copat"></div></div>';
export const PAGE_PATTERN_LAYER = '<div class="copatw pgp"><div class="copat"></div></div>';

// ---- company template

/** Where each part goes on a template, in card widths (100 across, 57.14 down). */
export const ZONES: Record<TemplateZone, {
  name: string;
  ph: { x: number; y: number; s: number };
  tx: { x: number; y: number; w: number; al: "left" | "right" | "center" };
  ct: { x: number; y?: number; b?: number; w: number; al: "left" | "right" | "center" };
  qr: { x: number; y?: number; b?: number; s: number } | null;
  band?: number;
}> = {
  A: { name: "Text left", ph: { x: 70, y: 8, s: 23 }, tx: { x: 6, y: 17, w: 58, al: "left" }, ct: { x: 6, b: 6.5, w: 64, al: "left" }, qr: { x: 81, b: 6, s: 13 } },
  B: { name: "Photo left", ph: { x: 7, y: 14, s: 21 }, tx: { x: 36, y: 17, w: 58, al: "right" }, ct: { x: 28, b: 6.5, w: 66, al: "right" }, qr: { x: 7, b: 6, s: 13 } },
  C: { name: "Centred", ph: { x: 41, y: 5, s: 18 }, tx: { x: 10, y: 25.5, w: 80, al: "center" }, ct: { x: 10, b: 6.5, w: 80, al: "center" }, qr: null },
  D: { name: "Bottom band", ph: { x: 6, y: 10, s: 21 }, tx: { x: 6, y: 37, w: 48, al: "left" }, ct: { x: 56, y: 37, w: 39, al: "left" }, qr: { x: 84, y: 4.5, s: 11 }, band: 34 },
};

export const TEXT_SIZE = { s: 0.88, m: 1, l: 1.12 } as const;

export const TEMPLATE_SAMPLES = [
  { id: "harbor", name: "Harbor Dawn", zone: "A" as TemplateZone },
  { id: "terra", name: "Terra Grid", zone: "B" as TemplateZone },
  { id: "night", name: "Night Orbit", zone: "C" as TemplateZone },
] as const;

const sv = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 400" width="700" height="400" preserveAspectRatio="xMidYMid slice">${inner}</svg>`;
const waves = (c1: string, c2: string, c3: string) =>
  `<path d="M0 320C110 290 190 350 320 325S540 290 700 330V400H0Z" fill="${c1}" fill-opacity=".55"/><path d="M0 350C130 325 230 380 360 352S560 330 700 360V400H0Z" fill="${c2}" fill-opacity=".6"/><path d="M0 378C150 360 260 400 400 380S600 366 700 385V400H0Z" fill="${c3}"/>`;

/** The three sample templates, front and back, as SVG text. */
export function templateSvg(id: string, side: "front" | "back"): string {
  const front = side === "front";
  if (id === "terra") {
    if (!front) return sv('<rect width="700" height="400" fill="#EFE8D8"/><path d="M0 400L120 290 240 400Z" fill="#1F6B4F"/><path d="M180 400L270 320 350 400Z" fill="#E6B54A"/><path d="M460 400L560 300 660 400Z" fill="#14513C"/><text x="350" y="46" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="24" letter-spacing="3" fill="#14513C">TERRA</text>');
    let t = "";
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 5; j++) {
        const c = ["#1F6B4F", "#2E8B67", "#E6B54A", "#C8DCC9", "#14513C"][(i * 3 + j * 2) % 5];
        t += `<rect x="${450 + i * 34}" y="${j * 34}" width="30" height="30" rx="4" fill="${c}" fill-opacity="${0.55 + ((i + j) % 3) * 0.15}"/>`;
      }
    }
    return sv(`<rect width="700" height="400" fill="#F6F1E7"/><path d="M0 0H430L380 400H0Z" fill="#EFE8D8"/>${t}<path d="M470 400L560 300 650 400Z" fill="#1F6B4F"/><path d="M560 400L640 330 700 400Z" fill="#E6B54A" fill-opacity=".9"/><rect x="30" y="28" width="30" height="30" rx="15" fill="#1F6B4F"/><path d="M45 36c8 4 8 14 0 18-8-4-8-14 0-18z" fill="#F6F1E7"/><text x="70" y="52" font-family="Georgia,serif" font-weight="700" font-size="24" letter-spacing="2" fill="#14513C">TERRA</text>`);
  }
  if (id === "night") {
    if (!front) return sv('<defs><radialGradient id="r" cx=".5" cy=".5" r=".75"><stop offset="0" stop-color="#241B4D"/><stop offset="1" stop-color="#0A0B16"/></radialGradient></defs><rect width="700" height="400" fill="url(#r)"/><g fill="none" stroke-width="2"><ellipse cx="350" cy="210" rx="330" ry="110" stroke="#FF4FA3" stroke-opacity=".35" transform="rotate(-14 350 210)"/><ellipse cx="350" cy="210" rx="290" ry="84" stroke="#2BD9E6" stroke-opacity=".35" transform="rotate(10 350 210)"/></g><text x="350" y="46" text-anchor="middle" font-family="Arial" font-weight="800" font-size="20" letter-spacing="6" fill="#fff">ORBITAL</text>');
    let st = "";
    for (let i = 0; i < 46; i++) st += `<circle cx="${(rnd(i) * 700).toFixed(0)}" cy="${(rnd(i + 90) * 400).toFixed(0)}" r="${(0.8 + rnd(i + 30) * 1.8).toFixed(1)}" fill="#fff" fill-opacity="${(0.25 + rnd(i + 7) * 0.6).toFixed(2)}"/>`;
    return sv(`<defs><radialGradient id="r" cx=".5" cy=".55" r=".7"><stop offset="0" stop-color="#241B4D"/><stop offset="1" stop-color="#0A0B16"/></radialGradient></defs><rect width="700" height="400" fill="url(#r)"/>${st}<g fill="none" stroke-width="2"><ellipse cx="350" cy="210" rx="300" ry="96" stroke="#FF4FA3" stroke-opacity=".5" transform="rotate(-14 350 210)"/><ellipse cx="350" cy="210" rx="250" ry="70" stroke="#2BD9E6" stroke-opacity=".5" transform="rotate(10 350 210)"/></g><circle cx="650" cy="40" r="10" fill="#FF4FA3"/><circle cx="56" cy="360" r="8" fill="#2BD9E6"/><circle cx="45" cy="43" r="14" fill="none" stroke="#2BD9E6" stroke-width="3"/><circle cx="45" cy="43" r="5" fill="#FF4FA3"/><text x="70" y="51" font-family="Arial" font-weight="800" font-size="22" letter-spacing="5" fill="#fff">ORBITAL</text>`);
  }
  // harbor (also the default)
  const grad = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A1F44"/><stop offset="1" stop-color="#1B3F8B"/></linearGradient></defs><rect width="700" height="400" fill="url(#g)"/>';
  if (!front) return sv(`${grad}${waves("#3E63B8", "#7FA8F2", "#C9DEFF")}<g fill="none" stroke="#9CC4FF" stroke-opacity=".22"><circle cx="70" cy="60" r="90"/><circle cx="70" cy="60" r="55"/></g><text x="350" y="46" text-anchor="middle" font-family="Arial" font-weight="800" font-size="20" letter-spacing="4" fill="#fff">HARBOR &amp; CO.</text>`);
  return sv(`${grad}<g fill="none" stroke="#9CC4FF" stroke-opacity=".28"><circle cx="560" cy="110" r="150"/><circle cx="560" cy="110" r="105"/><circle cx="560" cy="110" r="60"/></g><circle cx="560" cy="110" r="34" fill="#F5C26B"/>${waves("#3E63B8", "#7FA8F2", "#C9DEFF")}<rect x="30" y="28" width="30" height="30" rx="8" fill="#F5C26B"/><path d="M38 50l7-14 7 14z" fill="#0A1F44"/><text x="70" y="52" font-family="Arial" font-weight="800" font-size="22" letter-spacing="3" fill="#fff">HARBOR &amp; CO.</text>`);
}

export const templateUri = (id: string, side: "front" | "back") => svgUri(templateSvg(id, side));

/** A plain back made of the company colours, for an uploaded front that has no matching back. */
export function plainBackUri(pal: CompanyPalette): string {
  return svgUri(sv(`<rect width="700" height="400" fill="${pal.bg}"/><rect width="700" height="400" fill="${pal.bg2}" fill-opacity=".5"/><rect y="360" width="700" height="40" fill="${pal.acc}"/>`));
}

export interface TemplateInfo {
  /** Light text on a dark artwork, or the reverse. */
  light: boolean;
  /** Text contrast after the panel (when one is needed). */
  ratio: number;
  /** Which of the two text blocks (name, contacts) gets a soft panel behind it. */
  pn: [boolean, boolean];
  panel: boolean;
  band: boolean;
  /** Text colour for the QR back. */
  backFg: string;
}

const lumOf = (c: string) => {
  const v = h2r(c);
  return rl(r2h([v[0], v[1], v[2]]));
};

function zoneExtreme(st: ArtStats, r: [number, number, number, number], light: boolean): string {
  const g = st.grid;
  if (!g) return "#808080";
  const c0 = Math.max(0, Math.floor((r[0] / 100) * 14));
  const c1 = Math.min(13, Math.floor(((r[0] + r[2]) / 100) * 14));
  const r0 = Math.max(0, Math.floor((r[1] / FACE_H) * 8));
  const r1 = Math.min(7, Math.floor(((r[1] + r[3]) / FACE_H) * 8));
  let best: string | null = null;
  let bl = light ? -1 : 2;
  for (let y = r0; y <= r1; y++) {
    for (let x = c0; x <= c1; x++) {
      const c = g[y][x];
      const l = lumOf(c);
      if (light ? l > bl : l < bl) {
        bl = l;
        best = c;
      }
    }
  }
  return best || "#808080";
}

function zoneAverage(st: ArtStats, r: [number, number, number, number]): string {
  const g = st.grid;
  if (!g) return "#808080";
  const c0 = Math.max(0, Math.floor((r[0] / 100) * 14));
  const c1 = Math.min(13, Math.floor(((r[0] + r[2]) / 100) * 14));
  const r0 = Math.max(0, Math.floor((r[1] / FACE_H) * 8));
  const r1 = Math.min(7, Math.floor(((r[1] + r[3]) / FACE_H) * 8));
  let R = 0;
  let G = 0;
  let B = 0;
  let n = 0;
  for (let y = r0; y <= r1; y++) {
    for (let x = c0; x <= c1; x++) {
      const v = h2r(g[y][x]);
      R += v[0];
      G += v[1];
      B += v[2];
      n++;
    }
  }
  return n ? r2h([R / n, G / n, B / n]) : "#808080";
}

/**
 * Text colour and panels for a template. Light or dark text is chosen by how many of the two text blocks would be hard
 * to read on the artwork; a block that would be gets a soft panel. Zone D always draws a solid band. An artwork that was
 * not measured gets light text on dark panels, which reads on anything.
 */
export function templateInfo(zone: TemplateZone, textColour: string, front: ArtStats | null | undefined, back: ArtStats | null | undefined): TemplateInfo {
  const pr = ZONES[zone];
  const backFg = back && back.avg ? (rl(back.avg) > 0.35 ? "#101114" : WHITE) : WHITE;
  const forced = /^#[0-9a-f]{6}$/i.test(textColour) ? (rl(textColour) > 0.4 ? "light" : "dark") : textColour === "light" || textColour === "dark" ? textColour : "auto";
  if (!front || !front.grid) {
    const light = forced === "dark" ? false : true;
    return { light, ratio: 4.5, pn: pr.band ? [false, false] : [true, true], panel: !pr.band, band: !!pr.band, backFg };
  }
  const rects: [number, number, number, number][] = [
    [pr.tx.x, pr.tx.y, pr.tx.w, 17],
    [pr.ct.x, pr.ct.y != null ? pr.ct.y : FACE_H - (pr.ct.b ?? 0) - 11, pr.ct.w, 11],
  ];
  const per = (light: boolean) => {
    const fgc = light ? WHITE : "#101114";
    const pn: boolean[] = [];
    const ra: number[] = [];
    rects.forEach((r) => {
      const ex = zoneExtreme(front, r, light);
      const c = cr(fgc, ex);
      const need = c < 4.5;
      pn.push(need);
      ra.push(need ? cr(fgc, mix(light ? "#0B0D12" : WHITE, ex, 0.26)) : c);
    });
    return {
      pn: pn as [boolean, boolean], ratio: Math.min(ra[0], ra[1]),
      raw: Math.min(cr(fgc, zoneExtreme(front, rects[0], light)), cr(fgc, zoneExtreme(front, rects[1], light))), n: pn.filter(Boolean).length,
    };
  };
  if (pr.band) {
    const lg = forced === "dark" ? false : true;
    const av = zoneAverage(front, [0, pr.band, 100, FACE_H - pr.band]);
    return { light: lg, band: true, pn: [false, false], panel: false, ratio: lg ? cr(WHITE, mix("#0B0D12", av, 0.26)) : cr("#101114", mix(WHITE, av, 0.26)), backFg };
  }
  const lt = per(true);
  const dk = per(false);
  const light = forced === "light" || (forced === "auto" && (lt.n < dk.n || (lt.n === dk.n && lt.raw >= dk.raw)));
  const w = light ? lt : dk;
  return { light, ratio: w.ratio, pn: w.pn, panel: w.n > 0, band: false, backFg };
}

