// A real QR code as SVG path data, built synchronously so it can be drawn on the server too.
import QRCode from "qrcode";

export interface QrShape {
  /** Width and height of the drawing, including the quiet margin. */
  size: number;
  /** One path made of 1x1 squares. */
  d: string;
}

/** QR modules for a text, with a 2-module margin (as in the card back design). */
export function qrShape(text: string, margin = 2): QrShape {
  let n = 0;
  let isDark: (r: number, c: number) => boolean = () => false;
  try {
    const q = QRCode.create(text, { errorCorrectionLevel: "M" });
    n = q.modules.size;
    isDark = (r, c) => !!q.modules.get(r, c);
  } catch {
    return { size: 0, d: "" };
  }
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  return { size: n + 2 * margin, d };
}

/** The dark/light grid of a QR code, for drawing it in a custom style (see lib/qr). */
export interface QrModules {
  /** Modules along one side, without any quiet margin. */
  size: number;
  dark: (row: number, col: number) => boolean;
}

/** QR modules at a chosen error-correction level, or null when the text is too long to fit. */
export function qrModules(text: string, level: "L" | "M" | "Q" | "H" = "M"): QrModules | null {
  try {
    const q = QRCode.create(text, { errorCorrectionLevel: level });
    return { size: q.modules.size, dark: (r, c) => !!q.modules.get(r, c) };
  } catch {
    return null;
  }
}
