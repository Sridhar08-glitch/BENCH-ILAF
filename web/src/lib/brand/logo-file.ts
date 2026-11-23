// Turns any logo the owner picks (any shape or size, PNG, JPG, WebP or SVG) into a clean picture with its true
// proportions before it is uploaded: a white background around a flat logo is removed with soft edges, the empty
// margin is trimmed, and the result is a PNG of at most 800 px. Pictures for backgrounds and templates are shrunk
// to 1600 px on the owner's device. The pixel work is pure (and tested); the file reading needs the browser.

/** Longest side of a logo we keep. */
export const MAX_LOGO_PX = 800;
/** Longest side of a background or template picture. */
export const MAX_ART_PX = 1600;

type Pixels = Uint8ClampedArray | Uint8Array;

/**
 * A JPG or PNG on a plain white background: the white outside the logo is made transparent, with soft edges so it
 * sits cleanly on any colour. Returns false (and leaves the pixels alone) when the picture has no plain white border.
 */
export function keyWhite(px: Pixels, w: number, h: number): boolean {
  const n = w * h;
  const cs = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
  const bg = [0, 0, 0];
  let ok = true;
  cs.forEach((o) => {
    if (px[o + 3] < 240 || Math.min(px[o], px[o + 1], px[o + 2]) < 225) ok = false;
  });
  if (!ok) return false;
  for (let i = 0; i < 3; i++) bg[i] = (px[cs[0] + i] + px[cs[1] + i] + px[cs[2] + i] + px[cs[3] + i]) / 4;
  cs.forEach((o) => {
    for (let c = 0; c < 3; c++) if (Math.abs(px[o + c] - bg[c]) > 20) ok = false;
  });
  if (!ok) return false;
  const out = new Uint8Array(n);
  const st = new Int32Array(n);
  let sp = 0;
  const tol = 34;
  const near = (p: number) => Math.abs(px[p * 4] - bg[0]) <= tol && Math.abs(px[p * 4 + 1] - bg[1]) <= tol && Math.abs(px[p * 4 + 2] - bg[2]) <= tol && px[p * 4 + 3] > 200;
  const push = (p: number) => {
    if (!out[p] && near(p)) {
      out[p] = 1;
      st[sp++] = p;
    }
  };
  for (let i = 0; i < w; i++) {
    push(i);
    push((h - 1) * w + i);
  }
  for (let i = 0; i < h; i++) {
    push(i * w);
    push(i * w + w - 1);
  }
  while (sp > 0) {
    const p = st[--sp];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  let cnt = 0;
  for (let i = 0; i < n; i++) if (out[i]) cnt++;
  if (cnt < n * 0.08) return false;
  // a thin band of edge pixels: pull the white out of their colour and keep the rest as transparency
  const edge = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const q = y * w + x;
      if (out[q]) continue;
      let nb = false;
      for (let dy = -2; dy <= 2 && !nb; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && out[yy * w + xx]) {
            nb = true;
            break;
          }
        }
      }
      if (nb) edge[q] = 1;
    }
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (out[i]) {
      px[o + 3] = 0;
      continue;
    }
    if (edge[i]) {
      let a = 0;
      for (let c = 0; c < 3; c++) {
        const t = px[o + c] < bg[c] ? (bg[c] - px[o + c]) / bg[c] : (px[o + c] - bg[c]) / Math.max(1, 255 - bg[c]);
        if (t > a) a = t;
      }
      a = Math.min(1, a * 1.15);
      if (a < 0.04) {
        px[o + 3] = 0;
        continue;
      }
      for (let c = 0; c < 3; c++) px[o + c] = Math.max(0, Math.min(255, Math.round(bg[c] + (px[o + c] - bg[c]) / a)));
      px[o + 3] = Math.round(px[o + 3] * a);
    }
  }
  return true;
}

/** The box that holds every visible pixel (a hair of space kept), or null when the picture is empty. */
export function trimBounds(px: Pixels, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  return { x0: Math.max(0, x0 - 1), y0: Math.max(0, y0 - 1), x1: Math.min(w - 1, x1 + 1), y1: Math.min(h - 1, y1 + 1) };
}

/** The size a picture is shrunk to so its longest side is at most `max` (never enlarged). */
export function fitInside(w: number, h: number, max: number): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// ---- browser part

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("read"));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("image"));
    im.src = src;
  });
}

/** An SVG without a width and height (or only percentages) gets a real size from its viewBox so it can be drawn. */
async function sizedSvg(file: Blob): Promise<string | null> {
  try {
    const txt = await file.text();
    const d = new DOMParser().parseFromString(txt, "image/svg+xml");
    const s = d.documentElement;
    if (!s || s.nodeName.toLowerCase() !== "svg" || d.getElementsByTagName("parsererror").length) return null;
    let vb = (s.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(parseFloat);
    const wAttr = s.getAttribute("width") || "";
    const hAttr = s.getAttribute("height") || "";
    let w = /%/.test(wAttr) ? NaN : parseFloat(wAttr);
    let h = /%/.test(hAttr) ? NaN : parseFloat(hAttr);
    const ok = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
    if (!ok) {
      if (!(w > 0 && h > 0)) {
        w = 300;
        h = 150;
      }
      vb = [0, 0, w, h];
    }
    const k = MAX_LOGO_PX / Math.max(vb[2], vb[3]);
    s.setAttribute("viewBox", vb.join(" "));
    s.setAttribute("width", String(Math.round(vb[2] * k)));
    s.setAttribute("height", String(Math.round(vb[3] * k)));
    if (!s.getAttribute("xmlns")) s.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(s));
  } catch {
    return null;
  }
}

function toBlob(cv: HTMLCanvasElement, type: string, q?: number): Promise<Blob> {
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("blob"))), type, q));
}

/** A clean PNG of the logo (flat white background removed, margin trimmed, at most 800 px). Throws when the file is not a picture. */
export async function prepareLogo(file: File): Promise<Blob> {
  let src: string;
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) src = (await sizedSvg(file)) ?? (await readAsDataUrl(file));
  else src = await readAsDataUrl(file);
  const im = await loadImage(src);
  const nw = im.naturalWidth;
  const nh = im.naturalHeight;
  if (!nw || !nh) throw new Error("size");
  const { w, h } = fitInside(nw, nh, MAX_LOGO_PX);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext("2d");
  if (!cx) throw new Error("canvas");
  cx.imageSmoothingQuality = "high";
  cx.drawImage(im, 0, 0, w, h);
  const id = cx.getImageData(0, 0, w, h);
  if (keyWhite(id.data, w, h)) cx.putImageData(id, 0, 0);
  const b = trimBounds(id.data, w, h);
  if (!b) throw new Error("empty");
  const tw = b.x1 - b.x0 + 1;
  const th = b.y1 - b.y0 + 1;
  if (tw === w && th === h) return toBlob(cv, "image/png");
  const out = document.createElement("canvas");
  out.width = tw;
  out.height = th;
  out.getContext("2d")?.drawImage(cv, b.x0, b.y0, tw, th, 0, 0, tw, th);
  return toBlob(out, "image/png");
}

/** A background or template picture shrunk to 1600 px as a JPEG (flat white behind any transparency). */
export async function prepareArt(file: File): Promise<Blob> {
  const im = await loadImage(await readAsDataUrl(file));
  const { w, h } = fitInside(im.naturalWidth, im.naturalHeight, MAX_ART_PX);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext("2d");
  if (!cx) throw new Error("canvas");
  cx.imageSmoothingQuality = "high";
  cx.fillStyle = "#FFFFFF";
  cx.fillRect(0, 0, w, h);
  cx.drawImage(im, 0, 0, w, h);
  return toBlob(cv, "image/jpeg", 0.86);
}
