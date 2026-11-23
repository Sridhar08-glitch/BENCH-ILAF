// Pictures are accepted as PNG, JPG or WebP only (the API refuses every other format, SVG and GIF included).

/** The `accept` value of every picture upload input. */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

/** True for a PNG, JPG or WebP file. The file name decides only when the browser gave no type. */
export function isAllowedImage(file: { type: string; name: string }): boolean {
  if (file.type) return /^image\/(png|jpe?g|webp)$/i.test(file.type);
  return /\.(png|jpe?g|webp)$/i.test(file.name);
}
