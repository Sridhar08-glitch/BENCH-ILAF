// Finding the right logo for a button: from the owner's choice, the kind, or the link's domain.
// Pure functions only; the logo data itself (about 3,000 brands) lives on the server.
import type { ItemIcon } from "@/lib/types";

export interface BrandEntry {
  slug: string;
  title: string;
  hex: string;
}

/** Logo picked for one button, ready for the card renderer. */
export type ResolvedIcon =
  | { t: "image"; url: string }
  | { t: "brand"; path: string; hex: string; title: string }
  | { t: "lucide"; key: string }
  | { t: "kind" };

/** Short and alternative domains that do not match the brand's own name. */
export const SHORT_DOMAINS: Record<string, string> = {
  "wa.me": "whatsapp", "wa.link": "whatsapp", "whatsapp.com": "whatsapp",
  "t.me": "telegram", "telegram.me": "telegram", "telegram.org": "telegram",
  "youtu.be": "youtube", "fb.com": "facebook", "fb.me": "facebook", "m.me": "messenger",
  "ig.me": "instagram", "instagr.am": "instagram", "lnkd.in": "linkedin",
  "twitter.com": "x", "x.com": "x", "t.co": "x",
  "linktr.ee": "linktree", "maps.app.goo.gl": "googlemaps", "g.page": "googlemaps", "goo.gl": "google",
  "maps.google.com": "googlemaps", "mail.google.com": "gmail", "gmail.com": "gmail", "googlemail.com": "gmail",
  "outlook.com": "microsoftoutlook", "outlook.live.com": "microsoftoutlook", "hotmail.com": "microsoftoutlook", "live.com": "microsoftoutlook",
  "proton.me": "protonmail", "protonmail.com": "protonmail", "pm.me": "protonmail",
  "icloud.com": "icloud", "me.com": "icloud", "yahoo.com": "yahoo", "ymail.com": "yahoo",
  "discord.gg": "discord", "discord.com": "discord", "pin.it": "pinterest", "bit.ly": "bitly",
  "apps.apple.com": "appstore", "itunes.apple.com": "appstore", "play.google.com": "googleplay",
  "paypal.me": "paypal", "open.spotify.com": "spotify", "spoti.fi": "spotify", "music.apple.com": "applemusic",
  "docs.google.com": "googledocs", "drive.google.com": "googledrive", "meet.google.com": "googlemeet",
  "zoom.us": "zoom", "teams.microsoft.com": "microsoftteams", "calendly.com": "calendly",
  "wa.me/message": "whatsapp", "vm.tiktok.com": "tiktok", "tiktok.com": "tiktok", "snapchat.com": "snapchat",
  "medium.com": "medium", "reddit.com": "reddit", "redd.it": "reddit", "twitch.tv": "twitch", "github.io": "github",
  "behance.net": "behance", "dribbble.com": "dribbble", "soundcloud.com": "soundcloud", "threads.net": "threads",
  "cal.com": "caldotcom", "calendar.app.google": "googlecalendar", "calendar.google.com": "googlecalendar",
  "outlook.office365.com": "microsoftoutlook", "outlook.office.com": "microsoftoutlook", "bookings.microsoft.com": "microsoftoutlook", "book.ms": "microsoftoutlook",
  "tidycal.com": "tidycal", "savvycal.com": "savvycal", "meetings.hubspot.com": "hubspot",
  "skype.com": "skype", "viber.com": "viber", "signal.org": "signal", "line.me": "line", "wechat.com": "wechat",
};

/** Mail services whose logo fits an email button. */
export const MAIL_BRANDS = new Set(["gmail", "protonmail", "icloud", "yahoo", "microsoftoutlook", "fastmail", "tutanota", "zoho", "gmx", "maildotcom"]);

/** Lower-case letters and digits only, so "Proton Mail" and "protonmail" compare equal. */
export function squashName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The host of a typed value: a web address, a bare domain or the domain part of an email. Null otherwise. */
export function hostOf(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const email = /^(?:mailto:)?[^\s@/:]+@([^\s@/:]+\.[^\s@/:]+)$/i.exec(v);
  if (email) return email[1].toLowerCase();
  if (/^(tel|sms|geo|skype|facetime|facetime-audio|tg|viber):/i.test(v)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const h = new URL(withScheme).hostname.toLowerCase();
    return h.includes(".") ? h : null;
  } catch {
    return null;
  }
}

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

/** The part of a host that carries the brand name: "www.shop.nike.com" -> "nike", "bbc.co.uk" -> "bbc". */
export function brandNameOfHost(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length < 2) return parts[0] ?? "";
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  if (parts.length >= 3 && SECOND_LEVEL.has(sld) && tld.length === 2) return parts[parts.length - 3];
  return sld;
}

export interface BrandLookup {
  bySlug: Map<string, BrandEntry>;
  /** Brand titles with spaces and punctuation removed. */
  byTitle: Map<string, BrandEntry>;
}

export function buildLookup(entries: BrandEntry[]): BrandLookup {
  const bySlug = new Map<string, BrandEntry>();
  const byTitle = new Map<string, BrandEntry>();
  for (const e of entries) {
    bySlug.set(e.slug, e);
    const t = squashName(e.title);
    if (!byTitle.has(t)) byTitle.set(t, e);
  }
  return { bySlug, byTitle };
}

/** Which brand a website belongs to, or null when it is not a known brand. */
export function brandFromHost(host: string, lk: BrandLookup): BrandEntry | null {
  const h = host.toLowerCase().replace(/^www\./, "");
  // Exact short domain, then the same domain with any sub-domain in front of it.
  let short = SHORT_DOMAINS[h];
  if (!short) {
    const key = Object.keys(SHORT_DOMAINS).find((k) => h.endsWith(`.${k}`));
    if (key) short = SHORT_DOMAINS[key];
  }
  if (short) {
    const e = lk.bySlug.get(short) ?? lk.byTitle.get(squashName(short));
    if (e) return e;
  }
  const name = squashName(brandNameOfHost(h));
  if (!name) return null;
  return lk.bySlug.get(name) ?? lk.byTitle.get(name) ?? null;
}

/** What the server knows how to look up. */
export interface IconLookup {
  /** Logo path and colour for a brand slug, or null. */
  brand(slug: string): { path: string; hex: string; title: string } | null;
  /** Brand for a website host, or null. */
  detect(host: string): BrandEntry | null;
}

/**
 * Pick the logo for one button. Order: the owner's own image, the owner's chosen brand logo,
 * the owner's chosen generic icon, then automatic (the platform's own logo, the link's brand,
 * a mail or phone icon, and finally a plain link icon).
 */
export function resolveIcon(
  item: { kind: string; value: string; icon?: ItemIcon | null },
  lk: IconLookup,
): ResolvedIcon {
  const ic = item.icon;
  if (ic?.type === "upload" && ic.image_url) return { t: "image", url: ic.image_url };
  if (ic?.type === "brand" && ic.key) {
    const b = lk.brand(ic.key);
    if (b) return { t: "brand", path: b.path, hex: b.hex, title: b.title };
  }
  if (ic?.type === "lucide" && ic.key) return { t: "lucide", key: ic.key };

  if (item.kind === "Meeting") return resolveMeetingIcon(item.value, lk);
  if (item.kind !== "Custom") return { t: "kind" };
  const v = item.value.trim();
  const isEmail = /^mailto:/i.test(v) || /^[^s@/:]+@[^s@/:]+.[^s@/:]+$/.test(v);
  const host = hostOf(v);
  if (host) {
    const e = lk.detect(host);
    // An email at a company's own domain is not that company's logo; only mail services get theirs.
    const b = e && (!isEmail || MAIL_BRANDS.has(e.slug)) ? lk.brand(e.slug) : null;
    if (b) return { t: "brand", path: b.path, hex: b.hex, title: b.title };
  }
  if (/^mailto:/i.test(v) || /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/.test(v)) return { t: "lucide", key: "mail" };
  if (/^(tel|sms):/i.test(v) || (/^\+?[\d\s().-]{6,}$/.test(v) && v.replace(/\D/g, "").length >= 6)) return { t: "lucide", key: "phone" };
  return { t: "kind" };
}

/** A booking link shows its provider's logo when known (Calendly, Google Calendar, Cal.com, Microsoft Bookings), else a calendar. */
function resolveMeetingIcon(value: string, lk: IconLookup): ResolvedIcon {
  const host = hostOf(value);
  const entry = host ? lk.detect(host) : null;
  const b = entry ? lk.brand(entry.slug) : null;
  if (b) return { t: "brand", path: b.path, hex: b.hex, title: b.title };
  return { t: "lucide", key: "calendar" };
}
