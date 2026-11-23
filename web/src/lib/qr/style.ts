// The look of a styled QR code and the checks that keep it scannable. Pure: no drawing here (see render.ts).
import { INK, WHITE, cr, normHex, okHex } from "@/lib/library/company/colour";

export const DOT_SHAPES = ["square", "rounded", "dots", "classy"] as const;
export const EYE_SHAPES = ["square", "rounded", "leaf"] as const;
export const FRAME_STYLES = ["none", "box", "bar", "bartop", "pill", "corners", "badge"] as const;
export const LOGO_KINDS = ["none", "company", "symbol", "photo"] as const;
export const SIZES = [512, 1024, 2048] as const;

export type DotShape = (typeof DOT_SHAPES)[number];
export type EyeShape = (typeof EYE_SHAPES)[number];
export type FrameStyle = (typeof FRAME_STYLES)[number];
export type LogoKind = (typeof LOGO_KINDS)[number];
export type EccLevel = "L" | "M" | "Q" | "H";

export interface QrStyle {
  dots: DotShape;
  eyes: EyeShape;
  /** The dark modules, "#rrggbb". */
  fg: string;
  /** The light modules and the area behind them. */
  bg: string;
  /** Colour of the three corner squares; empty means the same as `fg`. */
  eyeFg: string;
  frame: FrameStyle;
  /** The words on the frame, for example "Scan to save my contact". */
  label: string;
  /** Border or bar colour of the frame; empty means the same as `fg`. */
  frameColor: string;
  logo: LogoKind;
  /** Empty margin around the code, in modules (scanners need at least 2, 4 is the standard). */
  quiet: number;
  /** Plain black squares on white, whatever else is chosen: the safest version to print. */
  print: boolean;
}

export const DEFAULT_STYLE: QrStyle = {
  dots: "square", eyes: "square", fg: "#101114", bg: "#FFFFFF", eyeFg: "", frame: "none", label: "", frameColor: "", logo: "none", quiet: 4, print: false,
};

/** The longest frame text. */
export const MAX_LABEL = 32;
/** A logo may cover at most this share of the code's area. */
export const MAX_LOGO_AREA = 0.2;
export const MIN_QUIET = 0;
export const MAX_QUIET = 8;

const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback);
const hex = (v: unknown, fallback: string, allowEmpty = false): string => {
  if (allowEmpty && (v === "" || v == null)) return "";
  return typeof v === "string" && okHex(v) ? normHex(v) : fallback;
};

/** Anything stored or typed, turned into a complete valid style. */
export function normaliseStyle(raw: unknown): QrStyle {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const quiet = typeof r.quiet === "number" && Number.isFinite(r.quiet) ? Math.round(Math.min(MAX_QUIET, Math.max(MIN_QUIET, r.quiet))) : DEFAULT_STYLE.quiet;
  const label = typeof r.label === "string" ? r.label.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL) : "";
  return {
    dots: pick(r.dots, DOT_SHAPES, DEFAULT_STYLE.dots),
    eyes: pick(r.eyes, EYE_SHAPES, DEFAULT_STYLE.eyes),
    fg: hex(r.fg, DEFAULT_STYLE.fg),
    bg: hex(r.bg, DEFAULT_STYLE.bg),
    eyeFg: hex(r.eyeFg, "", true),
    frame: pick(r.frame, FRAME_STYLES, DEFAULT_STYLE.frame),
    label,
    frameColor: hex(r.frameColor, "", true),
    logo: pick(r.logo, LOGO_KINDS, DEFAULT_STYLE.logo),
    quiet,
    print: r.print === true,
  };
}

/** What is really drawn: the print version forces black squares on white, with a plain frame and a full quiet zone. */
export function effectiveStyle(s: QrStyle): QrStyle {
  if (!s.print) return s;
  return { ...s, dots: "square", eyes: "square", fg: "#000000", bg: "#FFFFFF", eyeFg: "", frameColor: s.frame === "none" ? "" : "#000000", quiet: Math.max(4, s.quiet) };
}

/** Error correction: the highest level when a logo covers part of the code, otherwise the usual medium one. */
export function eccFor(style: Pick<QrStyle, "logo">, hasLogoImage: boolean): EccLevel {
  return style.logo !== "none" && hasLogoImage ? "H" : "M";
}

/** The side, in modules, of the square a logo may cover: at most MAX_LOGO_AREA of the code, always odd so it sits in the middle. */
export function logoSide(size: number): number {
  const side = Math.floor(Math.sqrt(MAX_LOGO_AREA) * size);
  return Math.max(3, side % 2 === 0 ? side - 1 : side);
}

/** Share of the code's area a logo of `side` modules covers. */
export function logoShare(size: number, side: number): number {
  return (side * side) / (size * size);
}

export type GuardIssue =
  | { code: "low_contrast"; ratio: number }
  | { code: "light_on_dark" }
  | { code: "eye_contrast"; ratio: number }
  | { code: "quiet_none" }
  | { code: "quiet_small" }
  | { code: "frame_contrast"; ratio: number }
  | { code: "dense_dots" };

export interface Guard {
  /** ok: scans everywhere; warn: most phones read it but some may not; bad: likely unreadable. */
  level: "ok" | "warn" | "bad";
  issues: GuardIssue[];
  ratio: number;
}

/** Smallest contrast ratio between dark and light modules that phones read reliably. */
export const MIN_CONTRAST = 3;

/** Checks a style the way a scanner would see it. `bytes` is the size of the text in the code (a big one makes small shapes risky). */
export function scanGuard(style: QrStyle, opts: { bytes?: number } = {}): Guard {
  const s = effectiveStyle(style);
  const issues: GuardIssue[] = [];
  const ratio = round(cr(s.fg, s.bg));
  if (ratio < MIN_CONTRAST) issues.push({ code: "low_contrast", ratio });
  // Scanners expect dark squares on a light background; the other way round is read by many phones but not all.
  else if (lum(s.fg) > lum(s.bg)) issues.push({ code: "light_on_dark" });
  if (s.eyeFg) {
    const er = round(cr(s.eyeFg, s.bg));
    if (er < MIN_CONTRAST) issues.push({ code: "eye_contrast", ratio: er });
  }
  if (s.quiet === 0) issues.push({ code: "quiet_none" });
  else if (s.quiet < 2) issues.push({ code: "quiet_small" });
  if (s.frame !== "none" && s.frameColor) {
    const fr = round(cr(s.frameColor, s.bg));
    if (fr < MIN_CONTRAST) issues.push({ code: "frame_contrast", ratio: fr });
  }
  if (s.dots === "dots" && (opts.bytes ?? 0) > 400) issues.push({ code: "dense_dots" });
  const bad = issues.some((i) => i.code === "low_contrast" || i.code === "eye_contrast" || i.code === "quiet_none");
  return { level: bad ? "bad" : issues.length ? "warn" : "ok", issues, ratio };
}

const round = (n: number) => Math.round(n * 10) / 10;
const lum = (h: string) => cr(h, "#000000");

/** A black or white colour that reads on `bg`. */
export function inkOn(bg: string): string {
  return cr(WHITE, bg) >= cr(INK, bg) ? WHITE : INK;
}

export interface QrPreset {
  id: string;
  /** i18n key of the name (the card's own colours have the card's wording). */
  nameKey: "growth.qrPresetBench" | "growth.qrPresetClassic" | "growth.qrPresetCard" | "growth.qrPresetCompany" | "growth.qrPresetAccent";
  fg: string;
  bg: string;
}

/** Colour pairs to start from: the product's own, plain black, the card's colours and the company's, only those that pass the scan check. */
export function presetsFor(card: { bg: string; fg: string; acc: string } | null, company: { bg: string; fg: string; acc: string } | null): QrPreset[] {
  const all: QrPreset[] = [
    { id: "bench", nameKey: "growth.qrPresetBench", fg: "#101114", bg: "#FFFFFF" },
    { id: "classic", nameKey: "growth.qrPresetClassic", fg: "#000000", bg: "#FFFFFF" },
  ];
  if (card) {
    all.push({ id: "card", nameKey: "growth.qrPresetCard", fg: card.bg, bg: "#FFFFFF" });
    all.push({ id: "card-acc", nameKey: "growth.qrPresetAccent", fg: card.acc, bg: "#FFFFFF" });
  }
  if (company) {
    all.push({ id: "company", nameKey: "growth.qrPresetCompany", fg: company.bg, bg: "#FFFFFF" });
    all.push({ id: "company-acc", nameKey: "growth.qrPresetAccent", fg: company.acc, bg: "#FFFFFF" });
  }
  const seen = new Set<string>();
  return all.filter((p) => {
    const key = `${p.fg.toLowerCase()}|${p.bg.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return cr(p.fg, p.bg) >= 4.5;
  });
}

/** Address-safe file name part of the saved style of one card. */
export const styleStorageKey = (cardId: string) => `bench.qrstyle.${cardId}`;
