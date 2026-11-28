// Small browser-only helpers that run after a card page is in the document. The markup from the engine is
// complete and readable without them; they only add polish (staggered link entrance, long names that fit,
// the corner of a face that the company logo can use, the opening animation).
import { overlayHtml, place, plan, specsFromData, type Box, type Spec } from "./company/marks";
import type { LogoChip, LogoCorner } from "@/lib/types";
import { clampTextSize } from "./textfit";

const STAGGER =
  ".dv .lk,.dv .ap,.dv .bbtn,.dv .bt,.dv .bwa,.dv .bmap,.dv .tn,.dv .er,.dv .sp-r,.dv .cp,.dv .cr2,.dv .acts span,.dv .dock .mk,.dv .reach div,.dv .dk-t div";

/** Give each link a number so the entrance animation can run one after another. */
function stagger(root: HTMLElement) {
  let n = 0;
  root.querySelectorAll<HTMLElement>(STAGGER).forEach((el) => el.style.setProperty("--i", String(Math.min(n++, 12))));
}

function hits(a: DOMRect, b: DOMRect) {
  return a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
}

const OBSTACLES = ".pw,.ph,.sp,.av,.arch,.im,.st,.rb,.cl,.colg,.tzp,.tzq,.tzc";

/**
 * A long name, title or wide font must never run into the photo or off the card: the title narrows beside a photo,
 * then name and title shrink together step by step until they clear.
 */
export function fitFaces(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".card .face:not(.back)").forEach((face) => {
    const n = face.querySelector<HTMLElement>(".n");
    if (!n) return;
    const fr = face.getBoundingClientRect();
    if (!fr.width) return;
    const cw = fr.width / 100;
    const ts = Array.from(face.querySelectorAll<HTMLElement>(".t1"));
    [n, ...ts].forEach((t) => {
      t.style.fontSize = "";
      t.style.maxWidth = "";
      t.style.whiteSpace = "";
    });
    // the contact lines are reset with the name and title: their last size would change the room the name is checked against
    face.querySelectorAll<HTMLElement>(".ln").forEach((l) => (l.style.fontSize = ""));
    const obsFor = (t: HTMLElement) => Array.from(face.querySelectorAll<HTMLElement>(OBSTACLES)).filter((o) => o !== t && !t.contains(o) && !o.contains(t));
    const bad = (t: HTMLElement) => {
      const rg = document.createRange();
      rg.selectNodeContents(t);
      const tr = rg.getBoundingClientRect();
      return tr.right > fr.right - fr.width * 0.03 || tr.left < fr.left || tr.bottom > fr.bottom - fr.height * 0.03 || tr.top < fr.top || obsFor(t).some((o) => hits(tr, o.getBoundingClientRect()));
    };
    ts.forEach((t) => {
      obsFor(t).forEach((o) => {
        const r = o.getBoundingClientRect();
        const tr = t.getBoundingClientRect();
        if (r.left > tr.left && hits(tr, r)) {
          t.style.whiteSpace = "normal";
          t.style.maxWidth = Math.max(fr.width * 0.25, r.left - tr.left - fr.width * 0.02) + "px";
        }
      });
    });
    const all = [n, ...ts];
    const base = all.map((t) => parseFloat(getComputedStyle(t).fontSize));
    let sc = 1;
    for (let k = 0; k < 9; k++) {
      if (!bad(n) && !ts.some(bad)) break;
      sc *= 0.93;
      all.forEach((t, i) => (t.style.fontSize = `${(base[i] * sc) / cw}cqw`));
    }
    face.querySelectorAll<HTMLElement>(".ln").forEach((l) => {
      l.style.fontSize = "";
      const b = l.querySelector("b");
      if (!b) return;
      const rg = document.createRange();
      rg.selectNodeContents(b);
      const r = rg.getBoundingClientRect();
      const lim = fr.right - fr.width * 0.035;
      if (r.right > lim && r.width) {
        const cs = parseFloat(getComputedStyle(l).fontSize);
        const f = Math.max(0.6, (lim - r.left) / r.width);
        l.style.fontSize = `${(cs * f) / cw}cqw`;
      }
    });
  });
}

// ---- page styles: a wider font or a larger size must not push the person's words out of their box

/** The shrink steps fitPageText may take and the smallest scale it goes to. */
const PAGE_FIT_STEP = 0.93;
const PAGE_FIT_FLOOR = 0.55;

/** The outermost marked text blocks of a page container (a block inside another block is part of it). */
function pageBlocks(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>("[data-fx]")).filter((el) => !el.parentElement?.closest("[data-fx]"));
}

/** A block leaves its page box or is cut off by its own box. */
function pageBlockBad(el: HTMLElement, box: DOMRect): boolean {
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  const rg = document.createRange();
  rg.selectNodeContents(el);
  const r = rg.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const pad = box.width * 0.02;
  return r.right > box.right - pad + 0.5 || r.left < box.left + pad - 0.5 || el.scrollWidth > el.clientWidth + 1;
}

/**
 * The text settings of a page style: a typeface that is wider than the style's own, or an enlarged size, can push a name past the
 * edge of its box or into the clipped end of a one-line label. Each marked block that is bad now but was not bad with the settings off
 * is scaled down (--fz, applied with zoom by TEXT_CSS) in small steps until it fits or reaches the floor. Blocks the style already
 * draws past an edge on purpose are left alone. Only cards that use a text setting are touched.
 */
export function fitPageText(root: HTMLElement) {
  const wraps = root.matches(".cfl") ? [root] : Array.from(root.querySelectorAll<HTMLElement>(".cfl"));
  wraps.forEach((wrap) => {
    const boxes = Array.from(wrap.querySelectorAll<HTMLElement>(".pg-top,.pg-bt"));
    if (!boxes.length) return;
    const on = ["tx-font", "tx-size"].filter((c) => wrap.classList.contains(c));
    boxes.forEach((b) => pageBlocks(b).forEach((el) => el.style.removeProperty("--fz")));
    if (!on.length) return;
    // what the style does by itself, with the settings off
    on.forEach((c) => wrap.classList.remove(c));
    const baseline = boxes.map((b) => {
      const br = b.getBoundingClientRect();
      return new Set(pageBlocks(b).filter((el) => pageBlockBad(el, br)));
    });
    on.forEach((c) => wrap.classList.add(c));
    boxes.forEach((b, i) => {
      const br = b.getBoundingClientRect();
      if (!br.width) return;
      pageBlocks(b).forEach((el) => {
        if (baseline[i].has(el)) return;
        let fz = 1;
        for (let k = 0; k < 12 && fz > PAGE_FIT_FLOOR && pageBlockBad(el, br); k++) {
          fz = Math.max(PAGE_FIT_FLOOR, fz * PAGE_FIT_STEP);
          el.style.setProperty("--fz", fz.toFixed(3));
        }
      });
    });
  });
}

// ---- company logo: measure the real face and find the corner no text or photo touches

const rgbHex = (m: RegExpMatchArray) => "#" + [0, 1, 2].map((i) => Math.round(+m[i]).toString(16).padStart(2, "0")).join("");
const alphaOf = (c: string) => {
  const m = c.match(/[\d.]+/g);
  return m ? (m.length > 3 ? parseFloat(m[3]) : 1) : 0;
};

/** Text and photo boxes of a face in card-width units. */
function obstaclesOf(face: HTMLElement): Box[] {
  const fr = face.getBoundingClientRect();
  const k = 100 / fr.width;
  const obs: Box[] = [];
  const add = (r: DOMRect, pad: number) => {
    if (r.width < 1 || r.height < 1) return;
    obs.push([(r.left - fr.left) * k - pad, (r.top - fr.top) * k - pad, (r.right - fr.left) * k + pad, (r.bottom - fr.top) * k + pad]);
  };
  const tw = document.createTreeWalker(face, NodeFilter.SHOW_TEXT);
  let t: Node | null;
  while ((t = tw.nextNode())) {
    if (!t.nodeValue?.trim()) continue;
    const pe = t.parentElement;
    const cs = pe && getComputedStyle(pe);
    if (!cs || cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.3) continue;
    const rg = document.createRange();
    rg.selectNodeContents(t);
    Array.from(rg.getClientRects()).forEach((r) => add(r, 0.8));
  }
  face.querySelectorAll<HTMLElement>("img,.pic,.pw,.ph,.mono,.av,.arch,.im,.st,.rb,.sp").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || parseFloat(cs.opacity) < 0.3) return;
    add(el.getBoundingClientRect(), 0.6);
  });
  const fa = fr.width * fr.height;
  face.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (el.classList.contains("fx") || (el.closest("svg") && el.tagName.toLowerCase() !== "svg")) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || parseFloat(cs.opacity) < 0.3) return;
    const box = alphaOf(cs.backgroundColor) > 0.25 || (cs.backgroundImage !== "none" && el.tagName.toLowerCase() !== "svg") || (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none");
    if (!box) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.width * r.height > fa * 0.5 || (r.width > fr.width * 0.9 && r.height < fr.height * 0.06)) return;
    add(r, 0.4);
  });
  return obs;
}

/** The flat colour behind a point of the face, or null where there is a picture or a gradient. */
function bgAt(mea: HTMLElement, fr: DOMRect, x: number, y: number): string | null {
  const k = fr.width / 100;
  const els = document.elementsFromPoint(fr.left + x * k, fr.top + y * k);
  for (const el of els) {
    if (!mea.contains(el) || el === mea) continue;
    const tg = el.tagName.toLowerCase();
    if (tg === "img" || tg === "svg" || tg === "canvas" || tg === "path" || tg === "video") return null;
    const cs = getComputedStyle(el);
    if (cs.backgroundImage !== "none") return null;
    const m = cs.backgroundColor.match(/[\d.]+/g);
    if (m) {
      const al = m.length > 3 ? parseFloat(m[3]) : 1;
      if (al >= 0.95) return rgbHex(m);
      if (al > 0.05) return null;
    }
  }
  return null;
}

/** Decoration drawn by gradients, pseudo elements or the face's texture layer cannot be read as a flat colour. */
function decorHits(face: HTMLElement, fr: DOMRect, r: Box): boolean {
  const k = fr.width / 100;
  const L = fr.left + r[0] * k;
  const T = fr.top + r[1] * k;
  const R = fr.left + r[2] * k;
  const B = fr.top + r[3] * k;
  const ix = (rc: DOMRect) => rc.left < R && rc.right > L && rc.top < B && rc.bottom > T;
  const vis = (cs: CSSStyleDeclaration) => alphaOf(cs.backgroundColor) > 0.05 || cs.backgroundImage !== "none";
  const all = [face, ...Array.from(face.querySelectorAll<HTMLElement>("*"))];
  for (const el of all) {
    if (el !== face && el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    const cs = getComputedStyle(el);
    if (!ix(el.getBoundingClientRect())) continue;
    if (el !== face && el.classList.contains("fx") && cs.backgroundImage !== "none") return true;
    if (el !== face && cs.backgroundImage !== "none" && el.tagName.toLowerCase() !== "svg") return true;
    const a = getComputedStyle(el, "::before");
    const b = getComputedStyle(el, "::after");
    if ((a.content !== "none" && vis(a)) || (b.content !== "none" && vis(b))) return true;
  }
  return false;
}

/** Which part of a face still shows a background picture: faces that cover most of it get a thin picture edge instead. */
function visibleShare(face: HTMLElement): number {
  const fr = face.getBoundingClientRect();
  if (getComputedStyle(face).backgroundImage !== "none") return 0.05;
  let vis = 0;
  let tot = 0;
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 14; gx++) {
      const x = fr.left + ((gx + 0.5) / 14) * fr.width;
      const y = fr.top + ((gy + 0.5) / 8) * fr.height;
      let show = true;
      for (const el of document.elementsFromPoint(x, y)) {
        if (el === face) break;
        if (!face.contains(el) || el.classList.contains("fx")) continue;
        const cs = getComputedStyle(el);
        const tg = el.tagName.toLowerCase();
        if (tg === "img" || alphaOf(cs.backgroundColor) > 0.85 || (cs.backgroundImage !== "none" && tg !== "svg")) {
          show = false;
          break;
        }
      }
      tot++;
      if (show) vis++;
    }
  }
  return vis / tot;
}

/** A copy of a card, without company decoration and not flipped, drawn off screen at the same width so it can be measured. */
function measureCopy(card: HTMLElement): { mea: HTMLElement; face: HTMLElement } | null {
  const w = card.getBoundingClientRect().width;
  if (!w) return null;
  const mea = document.createElement("div");
  mea.className = "cfl mea";
  mea.style.width = `${w}px`;
  const clone = card.cloneNode(true) as HTMLElement;
  clone.classList.remove("flipped");
  clone.querySelectorAll(".colg,.copatw,.coband").forEach((e) => e.remove());
  clone.querySelectorAll(".cobg").forEach((e) => e.classList.remove("cobg"));
  mea.appendChild(clone);
  document.body.appendChild(mea);
  const face = clone.querySelector<HTMLElement>(".face:not(.back)");
  if (!face) {
    mea.remove();
    return null;
  }
  return { mea, face };
}

function refineCard(card: HTMLElement) {
  const front = card.querySelector<HTMLElement>('.colg[data-co="front"]');
  const face = card.querySelector<HTMLElement>(".face:not(.back)");
  const needBand = !!face && (face.classList.contains("cobg") || face.classList.contains("cobandf"));
  if ((!front && !needBand) || card.querySelector(".tpf")) return;
  const copy = measureCopy(card);
  if (!copy) return;
  const { mea, face: mf } = copy;
  try {
    fitFaces(mea);
    const fr = mf.getBoundingClientRect();
    if (front) {
      const specs: Spec[] = specsFromData(front.dataset.specs || "[]");
      const pref = (front.dataset.pref || "auto") as LogoCorner;
      const setting = (front.dataset.chip || "auto") as LogoChip;
      const own = (front.dataset.own || "").split(",").filter(Boolean);
      const surf = front.dataset.surf;
      const pbg = (front.dataset.bg || "").toLowerCase();
      const obstacles = obstaclesOf(mf);
      const pts = [[0.5, 0.5], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]];
      const bgsAt = (r: Box) => {
        if (decorHits(mf, fr, r)) return null;
        const bgs = pts.map((p) => bgAt(mea, fr, r[0] + (r[2] - r[0]) * p[0], r[1] + (r[3] - r[1]) * p[1]));
        return surf ? bgs.map((b) => (b && b.toLowerCase() === pbg ? surf : b)) : bgs;
      };
      const size = Number(front.dataset.size || 100) / 100;
      const pl = plan(specs, (s) => place({ spec: s, pref, setting, obstacles, bgsAt, own, fallbackBgs: [], size }));
      const backEl = card.querySelector<HTMLElement>('.colg[data-co="back"]');
      const head = card.closest(".cfl")?.querySelector<HTMLElement>(".cohead");
      if (pl.moved) {
        // no corner is clean: the logo goes above the card instead
        front.hidden = true;
        if (backEl) backEl.hidden = true;
        head?.removeAttribute("hidden");
      } else {
        const tpl = document.createElement("template");
        tpl.innerHTML = overlayHtml(pl, front.dataset.alt || "");
        const next = tpl.content.firstElementChild as HTMLElement | null;
        if (next) {
          front.getAttributeNames().filter((a) => a.startsWith("data-") && a !== "data-c").forEach((a) => next.setAttribute(a, front.getAttribute(a) ?? ""));
          front.replaceWith(next);
        }
        if (backEl) backEl.hidden = false;
        if (head?.dataset.auto === "1") head.hidden = true;
      }
    }
    // a face that covers most of the card shows the background only as a thin edge
    if (needBand && face) {
      const thin = visibleShare(mf) < 0.35;
      const hasBand = !!face.querySelector(".coband");
      if (thin && !hasBand) {
        face.classList.remove("cobg");
        face.classList.add("cobandf");
        const band = document.createElement("div");
        band.className = "coband";
        face.appendChild(band);
      } else if (!thin && hasBand) {
        face.querySelector(".coband")?.remove();
        face.classList.remove("cobandf");
        face.classList.add("cobg");
      }
    }
  } finally {
    mea.remove();
  }
}

/** Choose the logo corner and the background edge from the face as it really looks (company cards only). */
export function refineCompany(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".card").forEach((card) => {
    if (card.querySelector('.colg[data-co="front"]') || card.querySelector(".cobg,.cobandf")) refineCard(card);
  });
}

interface Options {
  /** Measure faces for the company logo and background (off for small thumbnails). */
  measure?: boolean;
}

/** Everything that has to run once the markup is in the page. */
/**
 * A block of Arabic text that runs over more than one line reads from the right: where its box left-aligns text, it
 * is aligned to the right instead. A single line keeps the alignment of its box (so it lines up with the Latin
 * labels around it), and centred or already right-aligned boxes and boxes shared with other content are left alone.
 */
export function alignArabic(root: HTMLElement) {
  // what an earlier run set is undone first: a change of text size can turn a two-line block into one line, or back
  root.querySelectorAll<HTMLElement>("[data-ar-aligned]").forEach((b) => {
    b.style.textAlign = "";
    b.removeAttribute("data-ar-aligned");
  });
  root.querySelectorAll<HTMLElement>(".ar-all").forEach((run) => {
    const box = run.parentElement;
    if (!box || box.childNodes.length !== 1 || box === root) return;
    if (run.getClientRects().length < 2) return;
    const cs = getComputedStyle(box);
    if (cs.display === "inline" || cs.display === "contents") return;
    if (cs.textAlign === "left" || cs.textAlign === "start") {
      box.style.textAlign = "right";
      box.setAttribute("data-ar-aligned", "1");
    }
  });
}

/** What the faces do to long and Arabic text after they are laid out; the text size measuring repeats it on its copy. */
export function refit(root: HTMLElement) {
  alignArabic(root);
  fitFaces(root);
  fitPageText(root);
}

export function enhance(root: HTMLElement, o: Options = {}) {
  stagger(root);
  // the text size first: Arabic alignment and the long-name fitting depend on how large the text is
  clampTextSize(root, refit);
  alignArabic(root);
  if (o.measure !== false) refineCompany(root);
  fitFaces(root);
  fitPageText(root);
}

/** Run again after the fonts arrive: wide fonts change where text sits. */
export function settle(root: HTMLElement, o: Options = {}) {
  clampTextSize(root, refit);
  alignArabic(root);
  if (o.measure !== false) refineCompany(root);
  fitFaces(root);
  fitPageText(root);
}

/** How long the longest opening animation (with its delays) takes; afterwards the stage gets "still" and the card sits flat. */
export const OPENING_MS = 4500;
/** How long the flip lasts; the card keeps its perspective for this long after a tap. */
export const FLIP_MS = 900;

/** Start the opening animation (again). Without this class the card is fully visible and still. */
export function replay(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>(".stg");
  const page = root.querySelector<HTMLElement>(".pg");
  [stage, page].forEach((x) => x?.classList.remove("go"));
  stage?.classList.remove("still");
  void stage?.offsetWidth;
  stage?.classList.add("go");
  page?.classList.add("go");
}

/** The opening animation is over: the stage drops its perspective so the card is drawn flat and sharp. */
export function settleStage(root: HTMLElement) {
  root.querySelector<HTMLElement>(".stg")?.classList.add("still");
}
