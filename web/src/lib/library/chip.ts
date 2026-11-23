// The colour of each button's icon chip when the design says "use brand colours". The chip is the platform's own
// official colour, never tinted or darkened to fit a palette. Only when that colour would vanish against the page behind
// it, a plain light or dark chip is put behind the logo, which then keeps the brand colour.
// Pure functions, the same on the server and in the browser.
import { squashName, type ResolvedIcon } from "@/lib/card/brand";
import { WHITE, cr, normHex, rl } from "./company/colour";

/** Dark icon colour (the same ink the layouts use for their light chips). */
export const GLYPH_INK = "#0F172A";

/**
 * The official colour of every button kind. Kinds with no brand of their own get the colour of what they do: a call is
 * green, email red, a website the BENCH blue. A custom link has none and shows the card's accent.
 */
export const KIND_COLOURS: Record<string, string> = {
  Mobile: "#34C759",
  Landline: "#34C759",
  SMS: "#34C759",
  WhatsApp: "#25D366",
  Email: "#EA4335",
  Website: "#3B82F6",
  Location: "#34A853",
  Calendly: "#006BFF",
  Facebook: "#1877F2",
  Instagram: "#E4405F",
  LinkedIn: "#0A66C2",
  X: "#000000",
  YouTube: "#FF0000",
  TikTok: "#000000",
  Snapchat: "#FFFC00",
  Telegram: "#26A5E4",
  Pinterest: "#E60023",
  Threads: "#000000",
  GitHub: "#181717",
  Behance: "#1769FF",
  Dribbble: "#EA4C89",
  Discord: "#5865F2",
  Spotify: "#1DB954",
  SoundCloud: "#FF5500",
  Twitch: "#9146FF",
  Reddit: "#FF4500",
  Medium: "#000000",
  AppStore: "#000000",
  GooglePlay: "#414141",
  PayPal: "#003087",
  // More link types: a document or menu is the colour of what it is; the review, video and shop kinds use the site's own colour.
  Document: "#DC2626",
  DownloadFile: "#475569",
  Menu: "#F59E0B",
  Vimeo: "#1AB7EA",
  Loom: "#625DF5",
  GoogleReview: "#4285F4",
  Trustpilot: "#00B67A",
  TripAdvisor: "#34E0A1",
  AppleMaps: "#000000",
  WhatsAppChannel: "#25D366",
  Airbnb: "#FF5A5F",
  Etsy: "#F1641E",
  Shopify: "#7AB55C",
  Amazon: "#FF9900",
};

/** Official colours of brands a custom link can be recognised as (by the brand's name), where they differ from the logo set's own value. */
export const BRAND_COLOURS: Record<string, string> = {
  whatsapp: "#25D366", linkedin: "#0A66C2", facebook: "#1877F2", instagram: "#E4405F", x: "#000000", twitter: "#000000", youtube: "#FF0000",
  github: "#181717", tiktok: "#000000", telegram: "#26A5E4", snapchat: "#FFFC00", pinterest: "#E60023", behance: "#1769FF", dribbble: "#EA4C89",
  medium: "#000000", discord: "#5865F2", twitch: "#9146FF", spotify: "#1DB954", skype: "#00AFF0", viber: "#7360F2", signal: "#3A76F0",
  reddit: "#FF4500", threads: "#000000", zoom: "#0B5CFF", calendly: "#006BFF", googlemaps: "#34A853", gmail: "#EA4335",
};

/** Colours for a custom link whose owner picked a generic icon. */
const BY_ICON: Record<string, string> = { mail: "#EA4335", phone: "#34C759", globe: "#3B82F6", "map-pin": "#34A853", calendar: "#3B82F6" };

const HEX6 = /^#?[0-9a-f]{6}$/i;

/** The brand colour of a button ("#RRGGBB"), or null when it has none and shows the card's accent. */
export function chipBase(kind: string, res?: ResolvedIcon): string | null {
  if (res?.t === "brand") {
    const official = BRAND_COLOURS[squashName(res.title)];
    if (official) return official;
    return HEX6.test(res.hex) ? normHex(res.hex) : null;
  }
  if (kind === "Custom") return res?.t === "lucide" ? BY_ICON[res.key] ?? null : null;
  return KIND_COLOURS[kind] ?? null;
}

/** The icon colour on a chip: white, except on a very light colour (yellow) where it would disappear. */
export function glyphOn(bg: string): string {
  return cr(WHITE, bg) >= 1.6 ? WHITE : GLYPH_INK;
}

/** A brand colour that differs less than this from the page behind it vanishes. */
export const MIN_VISIBLE = 1.5;

/** Whether a brand colour would vanish against the page: too close in brightness, or a near-black logo on a dark page. */
export function vanishes(base: string, pageBg: string): boolean {
  const ratio = cr(base, pageBg);
  if (ratio < MIN_VISIBLE) return true;
  return rl(base) < 0.03 && rl(pageBg) < 0.12 && ratio < 3;
}

export interface Chip {
  /** Chip colour. */
  bc: string;
  /** Icon colour on the chip. */
  bf: string;
}

/**
 * The chip for a brand colour on a page. Normally the brand colour itself with its own icon colour. Where it would vanish,
 * a plain light or dark chip (whichever stands out from the page) goes behind the logo, and the logo keeps the brand colour.
 */
export function brandChip(base: string, pageBg: string): Chip {
  const bc = normHex(base);
  if (!vanishes(bc, pageBg)) return { bc, bf: glyphOn(bc) };
  const plain = cr(WHITE, pageBg) >= cr(GLYPH_INK, pageBg) ? WHITE : GLYPH_INK;
  return { bc: plain, bf: cr(bc, plain) >= 3 ? bc : plain === WHITE ? GLYPH_INK : WHITE };
}
