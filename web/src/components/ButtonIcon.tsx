// The icon for one card button. Order: the owner's own image, a brand logo (inline SVG path),
// a generic icon, then the platform's own logo, then a plain link icon.
import {
  siAirbnb, siAmazon, siApple, siBehance, siCalendly, siDiscord, siDribbble, siEtsy, siFacebook, siGithub, siGooglemaps,
  siGoogleplay, siInstagram, siLinkedin, siLoom, siMedium, siPaypal, siPinterest, siReddit, siShopify, siSnapchat,
  siSoundcloud, siSpotify, siTelegram, siThreads, siTiktok, siTripadvisor, siTrustpilot, siTwitch, siVimeo, siWhatsapp,
  siX, siYoutube,
} from "simple-icons";
import { Icon, hasIcon } from "./Icon";
import { LucideByKey } from "./lucide-set";
import { platformOf } from "@/lib/card/catalogue";
import type { ResolvedIcon } from "@/lib/card/brand";

/** The logos of the built-in brand platforms (path and brand colour): the 25 main ones and the extra link types. */
export const BUILT_IN: Record<string, { path: string; hex: string }> = {
  apple: siApple, behance: siBehance, calendly: siCalendly, discord: siDiscord,
  dribbble: siDribbble, facebook: siFacebook, github: siGithub, googlemaps: siGooglemaps,
  googleplay: siGoogleplay, instagram: siInstagram, linkedin: siLinkedin, medium: siMedium,
  paypal: siPaypal, pinterest: siPinterest, reddit: siReddit, snapchat: siSnapchat,
  soundcloud: siSoundcloud, spotify: siSpotify, telegram: siTelegram, threads: siThreads,
  tiktok: siTiktok, twitch: siTwitch, whatsapp: siWhatsapp, x: siX, youtube: siYoutube,
  vimeo: siVimeo, loom: siLoom, trustpilot: siTrustpilot, tripadvisor: siTripadvisor, airbnb: siAirbnb, etsy: siEtsy,
  shopify: siShopify, amazon: siAmazon,
};

function px(size?: "s" | "l"): number {
  return size === "s" ? 16 : size === "l" ? 24 : 20;
}

export function BrandGlyph({ path, size }: { path: string; size?: "s" | "l" }) {
  return (
    <svg width={px(size)} height={px(size)} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" style={{ flex: "none" }}>
      <path d={path} />
    </svg>
  );
}

/** Brand colour of a built-in platform (no leading #), or null. */
export function kindBrandHex(kind: string): string | null {
  const icon = platformOf(kind).icon;
  return icon.startsWith("b:") ? BUILT_IN[icon.slice(2)]?.hex ?? null : null;
}

/** Brand colour for a button, from its resolved logo or its platform. */
export function iconHex(kind: string, res?: ResolvedIcon): string | null {
  if (res?.t === "brand") return res.hex;
  if (res?.t === "image" || res?.t === "lucide") return null;
  return kindBrandHex(kind);
}

interface Props {
  kind: string;
  res?: ResolvedIcon;
  size?: "s" | "l";
}

export function ButtonIcon({ kind, res, size }: Props) {
  if (res?.t === "image") {
    return <img src={res.url} alt="" width={px(size)} height={px(size)} style={{ flex: "none", objectFit: "contain", borderRadius: 3 }} />;
  }
  if (res?.t === "brand") return <BrandGlyph path={res.path} size={size} />;
  if (res?.t === "lucide") return <LucideByKey name={res.key} size={px(size)} />;

  const icon = platformOf(kind).icon;
  if (icon.startsWith("b:")) {
    const slug = icon.slice(2);
    const b = BUILT_IN[slug];
    if (b) return <BrandGlyph path={b.path} size={size} />;
    return <Icon name={hasIcon(slug) ? slug : "link"} size={size} />;
  }
  return <Icon name={icon.slice(2)} size={size} />;
}
