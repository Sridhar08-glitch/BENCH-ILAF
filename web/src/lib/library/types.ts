// Shapes shared by the design library and the card renderer.
import type { ResolvedIcon } from "@/lib/card/brand";
import type { Design, BrandArtwork, BrandColours, LogoChip, LogoCorner, LogoDisplay, LogoPlacement } from "@/lib/types";
import type { CompanyPalette } from "./company/colour";
import type { Locale } from "@/lib/i18n/config";
import type { CardLabels } from "@/lib/card/labels";
import type { CustomFaceData } from "./custom/types";

/** A picture of the company as measured by the server: true proportions and colours, so placement never guesses. */
export interface MarkInfo {
  url: string;
  /** Width divided by height. */
  asp: number;
  /** Average colour of the visible pixels. */
  col: string;
  /** The main colours and their share of the visible pixels (shares of 4% or more, up to 8 colours). */
  pal: [string, number][];
}

/** How light and dark a picture is, and a coarse 14 x 8 grid of its colours for placing text. */
export interface ArtStats {
  p8: string;
  p92: string;
  avg: string;
  grid: string[][] | null;
}

/** The logo repeated as a tile: a small picture as a data address, and whether it is a solid blob. */
export interface PatternMark {
  u: string;
  blob: boolean;
}

/** Everything measured about a company's pictures (any part may be missing: the card then uses plain defaults). */
export interface BrandInfo {
  logo?: MarkInfo | null;
  symbol?: MarkInfo | null;
  bg?: ArtStats | null;
  front?: ArtStats | null;
  back?: ArtStats | null;
  pat?: PatternMark | null;
}

/** The company side of a card: palette, logo options and artwork, in the shape the renderer uses. */
export interface CompanyBrand {
  companyName: string;
  logoUrl: string | null;
  symbolUrl?: string | null;
  palette?: CompanyPalette | null;
  /** The two colours the palette was made from (the samples are drawn from them). */
  colours?: BrandColours | null;
  logoDisplay?: LogoDisplay;
  logoPlacement?: LogoPlacement;
  logoCorner?: LogoCorner;
  logoChip?: LogoChip;
  showName?: boolean;
  artwork?: BrandArtwork;
  backgroundUrl?: string | null;
  templateFrontUrl?: string | null;
  templateBackUrl?: string | null;
  info?: BrandInfo;
}

/** What the card page needs to draw one card. */
export interface CardPageData {
  name: string;
  title: string;
  company: string;
  address: string;
  photoUrl: string | null;
  coverUrl?: string | null;
  items: { kind: string; value: string; label?: string; on?: boolean; res?: ResolvedIcon }[];
  saveContact: boolean;
  design: Design;
  /** Show the "Powered by" line. Falls back to the design's own switch. */
  footer?: boolean;
  brand?: CompanyBrand | null;
  /** Address the QR back points to. */
  publicUrl: string;
  /** The language of the words around the card (button names, Save contact, hint, footer). English when missing. */
  locale?: Locale;
  /** The company's own face, when the design chooses it (`design.custom_face` equal to its id). Otherwise the library face is drawn. */
  customFace?: CustomFaceData | null;
}

/** live: real links, taps are reported (public page). preview: real links in the editor. thumb: markup only. */
export type CardMode = "live" | "preview" | "thumb";

/** One button of the card as the engine draws it. */
export interface EngineItem {
  kind: string;
  label: string;
  /** Short name used under icons. */
  short: string;
  /** Text shown under or next to the label. */
  value: string;
  /** Safe link, or null when the button cannot be opened. */
  href: string | null;
  newTab: boolean;
  group: "c" | "s" | "w";
  /** Brand colour without "#", or null. */
  hex: string | null;
  /** Chip colour and icon colour with "#" (brand colour checked against the page), or null when the button shows the card's accent. */
  bc?: string | null;
  bf?: string | null;
  /** The logo as ready-made SVG or image markup. */
  iconHtml: string;
}

export interface EngineInput {
  person: {
    name: string;
    first: string;
    last: string;
    title: string;
    company: string;
    address: string;
    initials: string;
    photoUrl: string | null;
    coverUrl: string | null;
  };
  items: EngineItem[];
  publicUrl: string;
  qr: { size: number; d: string };
  design: Design;
  mode: CardMode;
  saveContact: boolean;
  footer: boolean;
  footerText: string;
  brand: { companyName: string; logoUrl: string | null } | null;
  /** Company colours that replace the face's own colourway (design colour 4). */
  palette?: CompanyPalette | null;
  /** Page colours (--pgbg, --pgfg, --pacc, --pon, --pgline, --pgsh) the engine returns as they are; without them it derives the old ones. */
  page?: Record<string, string>;
  flipped?: boolean;
  /** The language of the card and its fixed words (see lib/card/labels). */
  locale?: Locale;
  labels?: CardLabels;
  /** The company's own face drawn in place of the library face (see ./custom). */
  custom?: CustomFaceData | null;
}

export interface EngineResult {
  /** Goes inside the .cfl wrapper. */
  html: string;
  /** Page colours for the .cfl wrapper (--pgbg, --pgfg, --pacc, --pon, --pgline, --pgsh). */
  pageVars: Record<string, string>;
  /** The card colours that were used. */
  cardVars: { name: string; bg: string; bg2: string; fg: string; acc: string; on: string };
  /** Number of placeholder texts of missing buttons that a layout left behind (0 is clean). */
  leaks: number;
}
