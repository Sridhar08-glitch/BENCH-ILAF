// The brand page's working copy of the company brand and the rules for turning it into a save. Pure functions.
import { DEFAULT_COLOURS, normalizeArtwork } from "@/lib/library/company/brand";
import { derivePalette, type BrandMode } from "@/lib/library/company/colour";
import { COMPANY_COLOUR, normalizeDesign } from "@/lib/library";
import type { BrandPatch } from "@/lib/api";
import type { ArtworkMode, Brand, BrandArtwork, BrandColours, BrandPalette, LogoChip, LogoCorner, LogoDisplay, LogoPlacement } from "@/lib/types";

/** A brand with every setting present (the API may leave the new ones out for older companies). */
export type FullBrand = Brand & {
  logo_display: LogoDisplay;
  logo_placement: LogoPlacement;
  logo_corner: LogoCorner;
  logo_chip: LogoChip;
  show_company_name: boolean;
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
  const pal: BrandPalette = derivePalette(colours.primary, colours.accent, colours.mode as BrandMode).pal;
  return { ...b, colours, palette: pal };
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
    artwork: { mode: b.artwork.mode, background: b.artwork.background, pattern: b.artwork.pattern, template: b.artwork.template },
  };
}
