// The brand page's working copy of the company brand and the rules for turning it into a save. Pure functions.
import { DEFAULT_COLOURS, asLogoFree, asLogoSize, normalizeArtwork } from "@/lib/library/company/brand";
import { cr, derivePalette, type BrandMode } from "@/lib/library/company/colour";
import { COMPANY_COLOUR, normalizeDesign } from "@/lib/library";
import type { BrandPatch } from "@/lib/api";
import type { ArtworkMode, Brand, BrandArtwork, BrandColours, BrandPalette, LogoChip, LogoCorner, LogoDisplay, LogoFree, LogoPlacement, LogoSpot } from "@/lib/types";

/** A brand with every setting present (the API may leave the new ones out for older companies). */
export type FullBrand = Brand & {
  logo_display: LogoDisplay;
  logo_placement: LogoPlacement;
  logo_corner: LogoCorner;
  logo_chip: LogoChip;
  show_company_name: boolean;
  logo_size: number;
  logo_free: LogoFree;
  artwork: BrandArtwork;
};

export function fullBrand(b: Brand): FullBrand {
  return {
    ...b,
    design: normalizeDesign(b.design),
    colours: b.colours ?? null,
    palette: b.palette ?? null,
    logo_display: b.logo_display ?? "auto",
    logo_placement: b.logo_placement ?? "both",
    logo_corner: b.logo_corner ?? "auto",
    logo_chip: b.logo_chip ?? "auto",
    show_company_name: b.show_company_name !== false,
    logo_size: asLogoSize(b.logo_size),
    logo_free: asLogoFree(b.logo_free),
    artwork: normalizeArtwork(b.artwork),
    symbol_url: b.symbol_url ?? null,
    background_url: b.background_url ?? null,
    template_front_url: b.template_front_url ?? null,
    template_back_url: b.template_back_url ?? null,
  };
}

/** The colours with their palette (made from them), or no colours at all. */
export function withColours(b: FullBrand, colours: BrandColours | null): FullBrand {
  if (!colours) {
    // company colours go away: a design that used them goes back to the face's own first colourway
    const design = b.design.colour === COMPANY_COLOUR ? { ...b.design, colour: 0 } : b.design;
    return { ...b, colours: null, palette: null, design };
  }
  return { ...b, colours, palette: paletteFor(colours) };
}

/** The five card colours of two brand colours, with the owner's own text colour in place of the worked-out one when they chose one. */
export function paletteFor(c: BrandColours): BrandPalette {
  const pal: BrandPalette = derivePalette(c.primary, c.accent, c.mode as BrandMode).pal;
  return c.text ? { ...pal, fg: c.text } : pal;
}

/** How readable the text is on the card colours (the server asks for 4.5 on both backgrounds). */
export function textReadability(c: BrandColours): { onCard: number; onSecond: number; ok: boolean } {
  const p = paletteFor(c);
  const onCard = cr(p.fg, p.bg);
  const onSecond = cr(p.fg, p.bg2);
  return { onCard, onSecond, ok: onCard >= 4.5 && onSecond >= 4.5 };
}

export function startColours(b: FullBrand): BrandColours {
  return b.colours ?? { primary: DEFAULT_COLOURS.primary.toLowerCase(), accent: DEFAULT_COLOURS.accent.toLowerCase(), mode: "brand" };
}

/** What changing the way the brand appears also has to set so the choice shows something at once. */
export function withMode(b: FullBrand, mode: ArtworkMode): FullBrand {
  const a = structuredClone(b.artwork);
  a.mode = mode;
  if (mode === "background" && a.background.kind === "none") a.background = { ...a.background, kind: "sample", sample: "geo" };
  if (mode === "pattern") {
    a.pattern.enabled = true;
    if (a.pattern.combine_with_background && a.background.kind === "none") a.background = { ...a.background, kind: "sample", sample: "geo" };
  }
  if (mode === "template" && a.template.kind === "none") a.template = { ...a.template, kind: "sample", sample: "harbor", zone: "A" };
  return { ...b, artwork: a };
}

/** The save: the colours and the palette always go together; personal workspaces never send the company-only keys. */
export function brandPatch(b: FullBrand, company: boolean): BrandPatch {
  const base: BrandPatch = { company_name: b.company_name, website: b.website, design: b.design, lock_design: b.lock_design, show_footer: b.show_footer };
  if (!company) return base;
  return {
    ...base,
    lock_allows_departments: !!b.lock_allows_departments,
    colours: b.colours,
    palette: b.palette,
    logo_display: b.logo_display,
    logo_placement: b.logo_placement,
    logo_corner: b.logo_corner,
    logo_chip: b.logo_chip,
    show_company_name: b.show_company_name,
    logo_size: b.logo_size,
    logo_free: b.logo_free,
    artwork: { mode: b.artwork.mode, background: b.artwork.background, pattern: b.artwork.pattern, template: b.artwork.template },
  };
}

/** Which design a logo place belongs to: "t3" for page style 3, else "f12" for card face 12. */
export function designKey(d: { face: number; top: number }): string {
  return d.top > 0 ? `t${d.top}` : `f${d.face}`;
}

/** Where the owner put the logo on the company's current design, or null when it is placed automatically. */
export function logoSpotOf(b: FullBrand): LogoSpot | null {
  return b.logo_free[designKey(b.design)] ?? null;
}

/** The brand with the logo placed on the current design (a spot) or placed automatically again (null). */
export function withLogoSpot(b: FullBrand, spot: LogoSpot | null): FullBrand {
  const key = designKey(b.design);
  const next = { ...b.logo_free };
  if (spot) next[key] = { x: round1(spot.x), y: round1(spot.y), w: round1(spot.w) };
  else delete next[key];
  return { ...b, logo_free: next };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The logo place after a drag: kept inside the card. */
export function dragged(spot: LogoSpot, x: number, y: number, height: number): LogoSpot {
  return { ...spot, x: Math.min(100 - spot.w, Math.max(0, x)), y: Math.min(100 - height, Math.max(0, y)) };
}
