// Browser-only helpers for the styled QR code: turning the SVG into a PNG and a picture address into an embeddable one.
import { DEFAULT_STYLE, normaliseStyle, styleStorageKey, type QrStyle } from "./style";

/** The look saved for a card on this device (the default look when there is none). */
export function readStoredStyle(cardId: string): QrStyle {
  try {
    const raw = window.localStorage.getItem(styleStorageKey(cardId));
    return raw ? normaliseStyle(JSON.parse(raw)) : DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
}

/** Draws SVG text on a canvas `px` wide and returns it as a PNG. */
export function svgToPng(svg: string, px: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = px;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no canvas");
        ctx.drawImage(img, 0, 0, px, height);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no png"))), "image/png");
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("svg did not load"));
    };
    img.src = url;
  });
}

/** A picture as a data address, so it can sit inside the SVG and still be drawn on a canvas. Null when the picture cannot be read (a host that blocks cross-site pictures). */
export function imageDataUrl(url: string, max = 320): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Saves a blob as a file download. */
export function saveBlob(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
