// Reading text out of a photo happens in the browser, behind a small interface so the engine can be swapped or
// missing. The engine (tesseract.js) and its language files are loaded only when the scan page asks for them,
// and only from this site (public/ocr, copied there by scripts/copy-ocr.mjs). Nothing is fetched from a CDN, and no
// other page loads any of it.

export interface OcrProgress {
  /** A short plain word for what is happening: loading, reading. */
  stage: "loading" | "reading";
  /** 0 to 1. */
  progress: number;
}

export interface OcrResult {
  text: string;
  /** 0 to 100, as reported by the engine. */
  confidence: number;
}

export interface OcrEngine {
  readonly name: string;
  recognize(image: Blob, onProgress?: (p: OcrProgress) => void): Promise<OcrResult>;
  dispose(): Promise<void>;
}

/** Where the engine's own files live on this site. */
export const OCR_BASE = "/ocr";
/** The files that must exist for the engine to run. */
export const OCR_FILES = ["worker.min.js", "tesseract-core-simd-lstm.wasm.js", "eng.traineddata.gz", "ara.traineddata.gz"];

/** True when the engine's files were copied to this site (checked with small requests, nothing is downloaded in full). */
export async function ocrFilesPresent(base = OCR_BASE): Promise<boolean> {
  try {
    const checks = await Promise.all(OCR_FILES.map((f) => fetch(`${base}/${f}`, { method: "HEAD", cache: "force-cache" }).then((r) => r.ok).catch(() => false)));
    return checks.every(Boolean);
  } catch {
    return false;
  }
}

/** The tesseract.js engine, or null when its files are not on this site or it cannot start. */
export async function loadTesseractEngine(onProgress?: (p: OcrProgress) => void): Promise<OcrEngine | null> {
  if (!(await ocrFilesPresent())) return null;
  try {
    const { createWorker } = await import("tesseract.js");
    let current: ((p: OcrProgress) => void) | undefined = onProgress;
    const worker = await createWorker(["eng", "ara"], 1, {
      workerPath: `${OCR_BASE}/worker.min.js`,
      corePath: OCR_BASE,
      langPath: OCR_BASE,
      logger: (m: { status: string; progress: number }) => {
        const stage = /recognizing/i.test(m.status) ? "reading" : "loading";
        current?.({ stage, progress: Math.max(0, Math.min(1, m.progress ?? 0)) });
      },
    });
    return {
      name: "tesseract.js",
      async recognize(image, progress) {
        current = progress ?? onProgress;
        const { data } = await worker.recognize(image);
        return { text: data.text ?? "", confidence: data.confidence ?? 0 };
      },
      async dispose() {
        await worker.terminate();
      },
    };
  } catch {
    return null;
  }
}

/** The longest side a photo is shrunk to before reading: big enough for small print, small enough to be quick on a phone. */
export const MAX_SIDE = 2000;

/** Size to shrink a picture to (never enlarge). */
export function fitSide(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return { width, height };
  const k = max / longest;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/** Shrink and sharpen a photo (grey, more contrast) so it reads faster and better. Falls back to the original file. */
export async function prepareImage(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitSide(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.filter = "grayscale(1) contrast(1.25)";
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return out ?? file;
  } catch {
    return file;
  }
}
