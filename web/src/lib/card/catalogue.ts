// The list of buttons a card can have, and how each one turns into a link.
import type { CardItem, ItemKind } from "@/lib/types";
import { meetingProvider } from "./meeting";
import { KIND_LABELS } from "./label-keys";
import { tk, type MessageKey, type Params, type TFunction } from "@/lib/i18n";

export type PlatformGroup = "contact" | "social";

export interface Platform {
  key: ItemKind;
  /** Name shown in the picker. */
  name: string;
  /** Default label shown on the card button. */
  label: string;
  /** Contact buttons feed the quick-action icons; social ones are web links. */
  group: PlatformGroup;
  /** Icon id. "g:" = drawn icon, "b:" = brand logo. */
  icon: string;
  placeholder: string;
}

const P = (
  key: ItemKind, name: string, label: string, group: "c" | "s", icon: string, placeholder: string,
): Platform => ({ key, name, label, group: group === "c" ? "contact" : "social", icon, placeholder });

/** The 31 platforms, in picker order. */
export const PLATFORMS: Platform[] = [
  P("Mobile", "Mobile", "Call mobile", "c", "g:phone", "Phone number"),
  P("Landline", "Landline", "Call office", "c", "g:tel", "Phone number"),
  P("WhatsApp", "WhatsApp", "WhatsApp", "c", "b:whatsapp", "Number with country code"),
  P("Email", "Email", "Email", "c", "g:mail", "name@company.com"),
  P("SMS", "SMS", "Send SMS", "c", "g:chat", "Phone number"),
  P("Location", "Location", "Directions", "c", "b:googlemaps", "Google Maps link"),
  P("Website", "Website", "Website", "s", "g:globe", "yourcompany.com"),
  P("Facebook", "Facebook", "Facebook", "s", "b:facebook", "facebook.com/yourpage"),
  P("Instagram", "Instagram", "Instagram", "s", "b:instagram", "instagram.com/yourname"),
  P("LinkedIn", "LinkedIn", "LinkedIn", "s", "b:linkedin", "linkedin.com/in/yourname"),
  P("X", "X", "X", "s", "b:x", "x.com/yourname"),
  P("YouTube", "YouTube", "YouTube", "s", "b:youtube", "youtube.com/@channel"),
  P("TikTok", "TikTok", "TikTok", "s", "b:tiktok", "tiktok.com/@yourname"),
  P("Snapchat", "Snapchat", "Snapchat", "s", "b:snapchat", "snapchat.com/add/yourname"),
  P("Telegram", "Telegram", "Telegram", "s", "b:telegram", "t.me/yourname"),
  P("Pinterest", "Pinterest", "Pinterest", "s", "b:pinterest", "pinterest.com/yourname"),
  P("Threads", "Threads", "Threads", "s", "b:threads", "threads.net/@yourname"),
  P("GitHub", "GitHub", "GitHub", "s", "b:github", "github.com/yourname"),
  P("Behance", "Behance", "Behance", "s", "b:behance", "behance.net/yourname"),
  P("Dribbble", "Dribbble", "Dribbble", "s", "b:dribbble", "dribbble.com/yourname"),
  P("Discord", "Discord", "Discord", "s", "b:discord", "discord.gg/invite"),
  P("Spotify", "Spotify", "Spotify", "s", "b:spotify", "open.spotify.com/..."),
  P("SoundCloud", "SoundCloud", "SoundCloud", "s", "b:soundcloud", "soundcloud.com/yourname"),
  P("Twitch", "Twitch", "Twitch", "s", "b:twitch", "twitch.tv/yourname"),
  P("Reddit", "Reddit", "Reddit", "s", "b:reddit", "reddit.com/u/yourname"),
  P("Medium", "Medium", "Medium", "s", "b:medium", "medium.com/@yourname"),
  P("Calendly", "Calendly", "Book a meeting", "s", "b:calendly", "calendly.com/yourname"),
  P("AppStore", "App Store", "App Store", "s", "b:apple", "apps.apple.com/..."),
  P("GooglePlay", "Google Play", "Google Play", "s", "b:googleplay", "play.google.com/..."),
  P("PayPal", "PayPal", "Pay me", "s", "b:paypal", "paypal.me/yourname"),
  P("Custom", "Custom link", "Link", "s", "g:link", "https://"),
];

/**
 * Kinds that exist beyond the 31 above. They are looked up like the others but are not part of the list the
 * brand-colour tables are checked against. The Meeting button takes its logo and colour from the booking link.
 */
export const EXTRA_PLATFORMS: Platform[] = [
  P("Meeting", "Book a meeting", "Book a meeting", "s", "g:link", "https://calendly.com/yourname"),
  // More link types (see MORE_KINDS in kind-rules.ts). Documents and menus use drawn icons, the rest the brand's own logo.
  P("Document", "PDF or catalogue", "Catalogue", "s", "g:doc", "https://yourcompany.com/catalogue.pdf"),
  P("DownloadFile", "Download file", "Download", "s", "g:download", "PDF"),
  P("Menu", "Menu", "Menu", "s", "g:utensils", "https://yourcompany.com/menu"),
  P("GoogleReview", "Google review", "Review us", "s", "g:star", "g.page/r/.../review"),
  P("Trustpilot", "Trustpilot", "Trustpilot", "s", "b:trustpilot", "trustpilot.com/review/yourcompany.com"),
  P("TripAdvisor", "TripAdvisor", "TripAdvisor", "s", "b:tripadvisor", "tripadvisor.com/..."),
  P("Vimeo", "Vimeo", "Vimeo", "s", "b:vimeo", "vimeo.com/..."),
  P("Loom", "Loom", "Loom", "s", "b:loom", "loom.com/share/..."),
  P("AppleMaps", "Apple Maps", "Apple Maps", "s", "g:pin", "maps.apple.com/..."),
  P("WhatsAppChannel", "WhatsApp channel", "Join our channel", "s", "b:whatsapp", "whatsapp.com/channel/..."),
  P("Airbnb", "Airbnb", "Airbnb", "s", "b:airbnb", "airbnb.com/..."),
  P("Etsy", "Etsy", "Etsy", "s", "b:etsy", "etsy.com/shop/yourshop"),
  P("Shopify", "Shopify store", "Shop", "s", "b:shopify", "yourstore.myshopify.com"),
  P("Amazon", "Amazon store", "Amazon", "s", "b:amazon", "amazon.com/..."),
];

const BY_KEY = new Map<string, Platform>([...PLATFORMS, ...EXTRA_PLATFORMS].map((p) => [p.key, p]));

/** Look up a platform; unknown kinds fall back to the custom link. */
export function platformOf(kind: string): Platform {
  return BY_KEY.get(kind) ?? (BY_KEY.get("Custom") as Platform);
}

/** The messages for the platform names that are words rather than brands. Brand names (WhatsApp, App Store, ...) stay as they are. */
const PLATFORM_NAMES: Record<string, MessageKey> = {
  Mobile: tk("editor.platMobile"), Landline: tk("editor.platLandline"), Email: tk("editor.platEmail"), SMS: tk("editor.platSms"),
  Location: tk("editor.platLocation"), Website: tk("editor.platWebsite"), Meeting: tk("editor.platMeeting"), Custom: tk("editor.platCustom"),
  Document: tk("cardx.platDocument"), DownloadFile: tk("cardx.platDownload"), Menu: tk("cardx.platMenu"), GoogleReview: tk("cardx.platReview"),
  WhatsAppChannel: tk("cardx.platChannel"), Shopify: tk("cardx.platShopify"), Amazon: tk("cardx.platAmazon"),
};

/** The messages for the placeholders that are words. Addresses such as "instagram.com/yourname" are the same in every language. */
const PLACEHOLDERS: Record<string, MessageKey> = {
  Mobile: tk("editor.phPhone"), Landline: tk("editor.phPhone"), SMS: tk("editor.phPhone"),
  WhatsApp: tk("editor.phWhatsapp"), Location: tk("editor.phMaps"),
};

/** The name of a platform in the language of `t` (English without it). */
export function platformName(kind: string, t?: TFunction): string {
  const p = platformOf(kind);
  const key = PLATFORM_NAMES[p.key];
  return key && t ? t(key) : p.name;
}

/** The hint inside an empty link field of a platform, in the language of `t` (English without it). */
export function platformPlaceholder(kind: string, t?: TFunction): string {
  const p = platformOf(kind);
  const key = PLACEHOLDERS[p.key];
  return key && t ? t(key) : p.placeholder;
}

/** The text shown on a card button. Custom links use the owner's own label. */
export function itemLabel(item: { kind: string; label?: string; value?: string }, t?: TFunction): string {
  const tr = (key: MessageKey, fallback: string, params?: Params) => (t ? t(key, params) : fallback);
  if (item.kind === "Custom") return item.label?.trim() || tr("card.btnLink", "Link");
  if (item.kind === "Meeting") {
    if (item.label?.trim()) return item.label.trim();
    const provider = item.value ? meetingProvider(item.value) : null;
    return provider ? tr("card.btnBookOn", `Book on ${provider.name}`, { name: provider.name }) : tr("card.btnBook", "Book a meeting");
  }
  const own = KIND_LABELS[item.kind];
  return own && t ? t(own) : platformOf(item.kind).label;
}

/** Items that are switched on and have a value (what visitors see). */
export function visibleItems<T extends { on?: boolean; value: string }>(items: T[]): T[] {
  return items.filter((i) => i.on !== false && i.value.trim() !== "");
}

/** Contact buttons used for the round quick-action icons (first four). */
export function quickActions<T extends { kind: string }>(items: T[]): T[] {
  return items.filter((i) => platformOf(i.kind).group === "contact").slice(0, 4);
}

export function digitsOf(v: string): string {
  return String(v).replace(/\D/g, "");
}

/** Make a web address out of whatever the owner typed. */
export function httpUrl(v: string): string {
  const t = v.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** True for the platforms that vCards store as labelled web links. */
export const SOCIAL_KINDS = new Set<string>(
  PLATFORMS.filter((p) => p.group === "social" && !["Website", "Calendly", "Meeting", "AppStore", "GooglePlay", "PayPal", "Custom"].includes(p.key)).map((p) => p.key),
);
export const WEB_KINDS = new Set<string>([
  "Website", "Calendly", "Meeting", "AppStore", "GooglePlay", "PayPal", "Custom", "Location",
  "Document", "DownloadFile", "Menu", "GoogleReview", "Trustpilot", "TripAdvisor", "Vimeo", "Loom", "AppleMaps", "WhatsAppChannel",
  "Airbnb", "Etsy", "Shopify", "Amazon",
]);

export type EditableItem = CardItem;
