// Browser-only measuring for the text size setting (design.size). A face is drawn off screen at the size asked for and
// at 100%; the size is accepted only when it adds no overlap, no clipping and no collision with the photo or panels
// that the face does not already have at 100%, and the face's own fitting of long names did not have to shrink the
// name or title further than at 100%. The rules themselves (pure, tested with synthetic boxes) are in ./text.
import {
  TEXT_CSS, TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX, addsNoProblem, appliedSize, keepsSize, largestFit, nearestFit, normalizeSize, problems, type Measured, type Rect,
} from "./text";

/** Things a name, title or contact line must not run into (the photo and the panels some faces draw). */
const OBSTACLES = ".pw,.ph,.sp,.av,.arch,.im,.st,.rb,.tzp,.tzq,.tzc";
const TEXT_BLOCKS = [".n", ".t1", ".t2", ".co", ".ln"];
const BLOCKS = TEXT_BLOCKS.join(",");
/** The wrapper width the measuring copy is laid out at, like a phone. */
const MEASURE_WIDTH = 390;

/** The face's own fitting of long names (fitFaces in ./enhance), run on the measuring copy so it predicts the finished card. */
export type Refit = (root: HTMLElement) => void;

const rectOf = (r: DOMRect): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

function visible(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden";
}

/** The text blocks and obstacles of a face as they sit right now. */
export function measureFace(face: HTMLElement): Measured {
  const fr = face.getBoundingClientRect();
  const texts: Measured["texts"] = [];
  const els: HTMLElement[] = [];
  for (const sel of TEXT_BLOCKS) {
    face.querySelectorAll<HTMLElement>(sel).forEach((el, i) => {
      // a block inside another text block is part of it
      const outer = el.parentElement?.closest(BLOCKS);
      if (outer && face.contains(outer)) return;
      if (!visible(el)) return;
      const rg = document.createRange();
      rg.selectNodeContents(el);
      const r = rg.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      texts.push({ id: `${sel.slice(1)}${i}`, rect: rectOf(r) });
      els.push(el);
    });
  }
  const obstacles: Measured["obstacles"] = [];
  face.querySelectorAll<HTMLElement>(OBSTACLES).forEach((o, i) => {
    if (!visible(o)) return;
    if (els.some((t) => t === o || t.contains(o) || o.contains(t))) return;
    const r = o.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    obstacles.push({ id: `${o.className.toString().split(/\s+/)[0] || o.tagName.toLowerCase()}${i}`, rect: rectOf(r) });
  });
  return { face: rectOf(fr), texts, obstacles };
}

/** The text stylesheet is on the page only while a card uses a text setting; the slider measures sizes before that, so the copy brings it. */
function ensureTextCss() {
  if (document.getElementById("tx-measure-css")) return;
  const style = document.createElement("style");
  style.id = "tx-measure-css";
  style.textContent = TEXT_CSS;
  document.head.appendChild(style);
}

/** A hidden copy of a card (front only, not flipped, without company decoration) laid out at `width` pixels, with the text settings of `wrapper`. */
function measuringCopy(wrapper: HTMLElement, card: HTMLElement, width: number): { host: HTMLElement; face: HTMLElement } | null {
  ensureTextCss();
  const host = document.createElement("div");
  host.className = ["cfl", "mea", ...Array.from(wrapper.classList).filter((c) => c.startsWith("tx-"))].join(" ");
  host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden`;
  for (const v of ["--tf", "--tfa", "--ts"]) {
    const val = wrapper.style.getPropertyValue(v);
    if (val) host.style.setProperty(v, val);
  }
  const clone = card.cloneNode(true) as HTMLElement;
  clone.classList.remove("flipped");
  clone.querySelectorAll(".colg,.copatw,.coband").forEach((e) => e.remove());
  clone.querySelectorAll(".cobg").forEach((e) => e.classList.remove("cobg"));
  host.appendChild(clone);
  document.body.appendChild(host);
  const face = clone.querySelector<HTMLElement>(".face:not(.back)");
  if (!face) {
    host.remove();
    return null;
  }
  return { host, face };
}

/** Draw the copy at a size (the text stylesheet scales the blocks with --ts). */
function setScale(host: HTMLElement, size: number) {
  host.classList.toggle("tx-size", size !== TEXT_SIZE_DEFAULT);
  host.style.setProperty("--ts", String(size / 100));
}

const fontSizeOf = (el: Element | null) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);

/** Tells whether a size fits the copy: no problem the face does not have at 100% and no further shrinking of the name or title by the face's own fitting. */
function fitter(host: HTMLElement, face: HTMLElement, refit: Refit): (size: number) => boolean {
  const run = (size: number) => {
    setScale(host, size);
    refit(host);
    return { found: problems(measureFace(face)), n: fontSizeOf(face.querySelector(".n")), t: fontSizeOf(face.querySelector(".t1")) };
  };
  const base = run(TEXT_SIZE_DEFAULT);
  return (size: number) => {
    if (size === TEXT_SIZE_DEFAULT) return true;
    const now = run(size);
    return addsNoProblem(now.found, base.found) && keepsSize(now.n, base.n) && keepsSize(now.t, base.t);
  };
}

const cache = new Map<string, number>();
const CACHE_MAX = 400;

/** Measure on a hidden copy of the card and remember the answer (the card markup, the width and the font decide it). */
function measured(wrapper: HTMLElement, card: HTMLElement, refit: Refit, what: string, compute: (fits: (size: number) => boolean) => number): number | null {
  const width = card.offsetWidth || MEASURE_WIDTH;
  const key = [what, width, wrapper.style.getPropertyValue("--tf"), card.innerHTML].join("|");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const copy = measuringCopy(wrapper, card, width);
  if (!copy) return null;
  try {
    const value = compute(fitter(copy.host, copy.face, refit));
    // an answer measured while a font file is still arriving used the wrong letter widths: it is not kept
    if (!document.fonts || document.fonts.status === "loaded") {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(key, value);
    }
    return value;
  } finally {
    copy.host.remove();
  }
}

/**
 * The largest size, up to 150, that fits this card. Never below 100: at 100% the card is drawn as the face draws it.
 * null when the card cannot be measured.
 */
export function maxFitOfCard(wrapper: HTMLElement, card: HTMLElement, refit: Refit): number | null {
  return measured(wrapper, card, refit, "max", (fits) => largestFit(fits, TEXT_SIZE_MAX, TEXT_SIZE_DEFAULT));
}

/**
 * Set --ts on every card of `root` that has a text size: an enlarged size is held to what fits, a smaller one is used
 * unless it breaks the face (a name that is placed by its own offsets moves when it shrinks), in which case the nearest
 * larger size that works is used. A card that cannot be measured keeps the safe scale the server wrote.
 */
export function clampTextSize(root: HTMLElement, refit: Refit) {
  root.querySelectorAll<HTMLElement>(".cfl").forEach((wrapper) => {
    if (!wrapper.style.getPropertyValue("--tsr")) return;
    const requested = normalizeSize(Number(wrapper.style.getPropertyValue("--tsr")));
    const card = wrapper.querySelector<HTMLElement>(".card");
    let size: number | null = null;
    if (card) {
      if (requested > TEXT_SIZE_DEFAULT) {
        const max = maxFitOfCard(wrapper, card, refit);
        size = max === null ? null : appliedSize(requested, max);
      } else {
        size = measured(wrapper, card, refit, `low${requested}`, (fits) => nearestFit(fits, requested));
      }
    }
    const applied = size ?? appliedSize(requested, null);
    wrapper.style.setProperty("--ts", String(applied / 100));
    // at 100% the card is exactly the face as drawn, with no zoom rule in play
    wrapper.classList.toggle("tx-size", applied !== TEXT_SIZE_DEFAULT);
  });
}

/**
 * The largest size that fits a card drawn from `html` (the markup of a card page, drawn at 100%), for the size
 * slider of the editor. `classes` and `vars` are the wrapper's text classes and style variables.
 */
export function maxFitOfHtml(html: string, classes: string, vars: Record<string, string>, refit: Refit): number | null {
  const wrapper = document.createElement("div");
  wrapper.className = `cfl ${classes}`.trim();
  wrapper.style.cssText = `position:fixed;left:0;top:0;width:${MEASURE_WIDTH}px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden`;
  for (const [k, v] of Object.entries(vars)) wrapper.style.setProperty(k, v);
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  try {
    const card = wrapper.querySelector<HTMLElement>(".card");
    return card ? maxFitOfCard(wrapper, card, refit) : null;
  } finally {
    wrapper.remove();
  }
}
