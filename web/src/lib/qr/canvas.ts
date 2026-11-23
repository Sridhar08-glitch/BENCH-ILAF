// Fills a styled QR code onto a canvas with the same path data the SVG uses (no logo and no frame: the page around it supplies those).
import type { QrModules } from "@/lib/card/qr";
import { qrPaths } from "./render";
import type { QrStyle } from "./style";

/** The parts of a 2D context this needs. */
export interface PathCtx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  fill(path: Path2D, rule?: CanvasFillRule): void;
}

/** Draws the code's modules in `rect` (which already includes its own margin: `margin` modules are left empty on every side). */
export function drawStyledQr(ctx: PathCtx, modules: QrModules, style: QrStyle, rect: { x: number; y: number; w: number }, margin: number, ink: string): void {
  const paths = qrPaths(modules, style, false);
  const cell = rect.w / (paths.size + 2 * margin);
  ctx.save();
  ctx.translate(rect.x + margin * cell, rect.y + margin * cell);
  ctx.scale(cell, cell);
  ctx.fillStyle = ink;
  ctx.fill(new Path2D(paths.dots));
  ctx.fill(new Path2D(paths.eyes), "evenodd");
  ctx.restore();
}
