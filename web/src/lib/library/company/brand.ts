// The company brand as the API sends it, turned into the complete, valid shape the renderer uses, and the list of
// pictures that have to be measured before the card can be drawn exactly (logo shape and colours, how light a background is).
import { asPalette, okHex, normHex } from "./colour";
import { BG_IDS, TEMPLATE_SAMPLES } from "./artwork";
import type { BrandArtwork, BrandColours, BrandLook, LogoChip, LogoCorner, LogoDisplay, LogoFree, LogoPlacement, TemplateZone } from "@/lib/types";
import type { CompanyBrand } from "../types";

export function defaultArtwork(): BrandArtwork {
  return {
    mode: "none",
    background: { kind: "none", sample: null, strength: 60 },
    pattern: { enabled: false, size: "m", spacing: "normal", angle: 0, opacity: 18, combine_with_background: false },
    template: { kind: "none", sample: null, zone: "A", text_colour: "auto", text_size: "m" },
  };
}

const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const num = (v: unknown, min: number, max: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : d);
const url = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Complete, valid artwork settings from anything the API sent: missing or wrong values take their defaults. */
export function normalizeArtwork(raw: unknown): BrandArtwork {
  const d = defaultArtwork();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, Record<string, unknown> | string | undefined>;
  const bg = (r.background && typeof r.background === "object" ? r.background : {}) as Record<string, unknown>;
  const pt = (r.pattern && typeof r.pattern === "object" ? r.pattern : {}) as Record<string, unknown>;
  const tp = (r.template && typeof r.template === "object" ? r.template : {}) as Record<string, unknown>;
  const angle = pt.angle === -15 || pt.angle === -30 ? pt.angle : 0;
  const tc = typeof tp.text_colour === "string" && /^#[0-9a-f]{6}$/i.test(tp.text_colour) ? tp.text_colour.toLowerCase() : "auto";
  return {
    mode: pick(r.mode, ["none", "background", "pattern", "template"] as const, d.mode),
    background: { kind: pick(bg.kind, ["sample", "upload", "none"] as const, "none"), sample: typeof bg.sample === "string" ? bg.sample : null, strength: num(bg.strength, 0, 100, d.background.strength) },
    pattern: {
      enabled: pt.enabled === true,
      size: pick(pt.size, ["s", "m", "l"] as const, d.pattern.size),
      spacing: pick(pt.spacing, ["tight", "normal", "wide"] as const, d.pattern.spacing),
      angle: angle as 0 | -15 | -30,
      opacity: num(pt.opacity, 5, 60, d.pattern.opacity),
      combine_with_background: pt.combine_with_background === true,
    },
    template: {
      kind: pick(tp.kind, ["sample", "upload", "none"] as const, "none"),
      sample: typeof tp.sample === "string" ? tp.sample : null,
      zone: pick(tp.zone, ["A", "B", "C", "D"] as const, "A") as TemplateZone,
      text_colour: tc,
      text_size: pick(tp.text_size, ["s", "m", "l"] as const, d.template.text_size),
    },
  };
}

function asColours(v: unknown): BrandColours | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (!okHex(r.primary) || !okHex(r.accent)) return null;
  const out: BrandColours = { primary: normHex(r.primary as string).toLowerCase(), accent: normHex(r.accent as string).toLowerCase(), mode: pick(r.mode, ["brand", "light", "dark"] as const, "brand") };
  if (okHex(r.text)) out.text = normHex(r.text as string).toLowerCase();
  return out;
}

/** The logo size: a whole percentage from 50 to 150, else 100. */
export function asLogoSize(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(150, Math.max(50, Math.round(v))) : 100;
}

/** The places the owner gave the logo: only well formed entries are kept. */
export function asLogoFree(v: unknown): LogoFree {
  const out: LogoFree = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[ft][0-9]{1,3}$/.test(key) || !raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const [x, y, w] = [r.x, r.y, r.w];
    if (typeof x !== "number" || typeof y !== "number" || typeof w !== "number") continue;
    if (![x, y, w].every(Number.isFinite) || w < 10 || w > 60) continue;
    out[key] = { x: Math.min(100 - w, Math.max(0, x)), y: Math.min(100, Math.max(0, y)), w };
  }
  return out;
}

/** The renderer's brand from the API's brand keys (workspace brand or public card brand). Returns null without a company name and logo or palette. */
export function toCompanyBrand(b: (BrandLook & { company_name: string }) | null | undefined): CompanyBrand | null {
  if (!b) return null;
  return {
    companyName: b.company_name ?? "",
    logoUrl: url(b.logo_url),
    symbolUrl: url(b.symbol_url),
    palette: asPalette(b.palette),
    colours: asColours(b.colours),
    logoDisplay: pick(b.logo_display, ["auto", "symbol", "symbol_name", "full"] as readonly LogoDisplay[], "auto"),
    logoPlacement: pick(b.logo_placement, ["card", "above", "both"] as readonly LogoPlacement[], "both"),
    logoCorner: pick(b.logo_corner, ["auto", "tl", "tr", "bl", "br"] as readonly LogoCorner[], "auto"),
    logoChip: pick(b.logo_chip, ["auto", "always", "never", "white", "black"] as readonly LogoChip[], "auto"),
    showName: b.show_company_name !== false,
    logoSize: asLogoSize(b.logo_size),
    logoFree: asLogoFree(b.logo_free),
    artwork: normalizeArtwork(b.artwork),
    backgroundUrl: url(b.background_url),
    templateFrontUrl: url(b.template_front_url),
    templateBackUrl: url(b.template_back_url),
  };
}

/** Used for sample backgrounds and the monogram when the company has not set colours yet. */
export const DEFAULT_COLOURS = { primary: "#1F3A5F", accent: "#D9A441" };

/** The two brand colours the samples and the monogram are drawn from. */
export function sampleColours(colours: { primary: string; accent: string } | null | undefined): { prim: string; acc: string } {
  const c = colours && okHex(colours.primary) && okHex(colours.accent) ? colours : DEFAULT_COLOURS;
  return { prim: normHex(c.primary), acc: normHex(c.accent) };
}

/** What has to be measured. `u` is a picture address; `bg`/`tpl` are samples drawn from the colours given. */
export type MeasureSource =
  | { role: "logo" | "symbol" | "bg" | "front" | "back"; u: string }
  | { role: "bg"; sample: string; p: string; a: string }
  | { role: "front" | "back"; tpl: string }
  | { role: "pat"; u: string };

/** The measurements this brand needs. The pattern's mark is chosen by the caller (it depends on the logo options). */
export function measureList(b: CompanyBrand, patternMarkUrl: string | null): MeasureSource[] {
  const out: MeasureSource[] = [];
  const { prim, acc } = sampleColours(b.colours);
  if (b.logoUrl) out.push({ role: "logo", u: b.logoUrl });
  if (b.symbolUrl) out.push({ role: "symbol", u: b.symbolUrl });
  const art = b.artwork ?? defaultArtwork();
  const usesBg = art.mode === "background" || (art.mode === "pattern" && art.pattern.combine_with_background);
  if (usesBg) {
    if (art.background.kind === "upload" && b.backgroundUrl) out.push({ role: "bg", u: b.backgroundUrl });
    else if (art.background.kind === "sample" && art.background.sample && BG_IDS.includes(art.background.sample)) out.push({ role: "bg", sample: art.background.sample, p: prim, a: acc });
  }
  if (art.mode === "pattern" && patternMarkUrl) out.push({ role: "pat", u: patternMarkUrl });
  if (art.mode === "template") {
    const t = art.template;
    if (t.kind === "upload" && b.templateFrontUrl) out.push({ role: "front", u: b.templateFrontUrl });
    else if (t.kind === "sample" && t.sample && TEMPLATE_SAMPLES.some((s) => s.id === t.sample)) out.push({ role: "front", tpl: t.sample });
    if (t.kind === "upload" && b.templateBackUrl) out.push({ role: "back", u: b.templateBackUrl });
    else if (t.kind === "sample" && t.sample && TEMPLATE_SAMPLES.some((s) => s.id === t.sample)) out.push({ role: "back", tpl: t.sample });
  }
  return out;
}
