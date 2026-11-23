// Turns what the owner typed into a link a visitor can safely tap.
// Only the schemes in ALLOWED_SCHEMES are ever produced; anything else gives no link.
import { MEETING_FORM_HREF, isMeetingForm, meetingUrl } from "./meeting";

/** The one list of link schemes a button may use. Add a scheme here to allow it everywhere. */
export const ALLOWED_SCHEMES = new Set([
  "http:", "https:", "tel:", "mailto:", "sms:", "skype:", "tg:", "viber:", "facetime:", "facetime-audio:", "geo:",
]);

/** Profile address for a bare handle, per network. `{h}` is the handle without "@". */
const HANDLE_URL: Record<string, string> = {
  Instagram: "https://instagram.com/{h}",
  Facebook: "https://facebook.com/{h}",
  X: "https://x.com/{h}",
  TikTok: "https://tiktok.com/@{h}",
  LinkedIn: "https://linkedin.com/in/{h}",
  YouTube: "https://youtube.com/@{h}",
  Snapchat: "https://snapchat.com/add/{h}",
  Telegram: "https://t.me/{h}",
  GitHub: "https://github.com/{h}",
  Behance: "https://behance.net/{h}",
  Dribbble: "https://dribbble.com/{h}",
  Pinterest: "https://pinterest.com/{h}",
  Threads: "https://threads.net/@{h}",
  Twitch: "https://twitch.tv/{h}",
  Reddit: "https://reddit.com/u/{h}",
  Medium: "https://medium.com/@{h}",
  SoundCloud: "https://soundcloud.com/{h}",
};

/** Kinds where a handle alone is not enough (the owner must paste a full link). */
const NEEDS_FULL_LINK = new Set(["Spotify", "Discord"]);

const COMMON_TLDS = new Set([
  "com", "net", "org", "me", "io", "co", "ly", "gg", "tv", "app", "ae", "qa", "sa", "uk", "de", "fr",
  "in", "us", "ca", "au", "info", "biz", "dev", "xyz", "link", "page", "site", "online", "shop", "store", "to", "be",
]);

/** Remove characters browsers ignore inside a link, so "java\tscript:" cannot sneak past the scheme check. */
function squash(v: string): string {
  return v.replace(new RegExp("[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]", "g"), "");
}

/** The explicit scheme at the start of a value ("javascript:", "tel:"), or null when there is none. */
function schemeOf(v: string): string | null {
  // A dot before the colon means a host with a port ("example.com:8080"), not a scheme.
  const m = /^([a-z][a-z0-9+-]*:)/i.exec(squash(v));
  return m ? m[1].toLowerCase() : null;
}

/** True when a finished link uses one of the allowed schemes. */
export function isSafeHref(href: string | null | undefined): href is string {
  if (!href) return false;
  const m = /^([a-z][a-z0-9+.-]*:)/i.exec(squash(href));
  return !!m && ALLOWED_SCHEMES.has(m[1].toLowerCase());
}

/** Web links open in a new tab; phone, SMS, mail and app links open normally. */
export function opensInNewTab(href: string): boolean {
  return /^https?:/i.test(href);
}

/** A web address from whatever was typed; null when the scheme is not allowed. */
function webUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const scheme = schemeOf(v);
  if (scheme) {
    if (scheme !== "http:" && scheme !== "https:") return null;
    return v;
  }
  // A web address never contains spaces.
  if (/\s/.test(v)) return null;
  // "//example.com" style links are treated as https.
  return `https://${v.replace(/^\/+/, "")}`;
}

function looksLikeDomain(v: string): boolean {
  if (v.includes("/")) return true;
  const parts = v.split(".");
  if (parts.length < 2) return false;
  return COMMON_TLDS.has(parts[parts.length - 1].toLowerCase());
}

/** Google Maps search link for a plain address or place name. */
export function mapsSearchUrl(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t)}`;
}

/** True when a location value is already a link (so it should be opened as is). */
function isLocationLink(v: string): boolean {
  if (schemeOf(v)) return true;
  return /^(www\.|maps\.|goo\.gl\/|maps\.app\.goo\.gl\/|google\.[a-z.]+\/|g\.page\/|what3words\.com\/)/i.test(v);
}

/**
 * The link for one button, or null when the value is empty or unsafe.
 * Examples: ("Mobile", "+971 50 123 4567") -> "tel:+971501234567".
 */
export function hrefFor(kind: string, value: string): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;

  switch (kind) {
    case "Mobile":
    case "Landline":
    case "SMS": {
      const scheme = schemeOf(v);
      const bare = scheme === "tel:" || scheme === "sms:" ? v.slice(scheme.length) : v;
      if (schemeOf(bare)) return null;
      const num = bare.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
      if (!num) return null;
      return `${kind === "SMS" ? "sms:" : "tel:"}${num}`;
    }
    case "WhatsApp": {
      if (schemeOf(v) || /^(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\//i.test(v)) return webUrl(v);
      let digits = v.replace(/\D/g, "");
      if (digits.startsWith("00")) digits = digits.slice(2);
      return digits ? `https://wa.me/${digits}` : null;
    }
    case "Email": {
      const scheme = schemeOf(v);
      const addr = (scheme === "mailto:" ? v.slice(scheme.length) : v).trim();
      if (!addr || schemeOf(addr) || /[\s<>]/.test(addr)) return null;
      return `mailto:${addr}`;
    }
    case "Location": {
      if (isLocationLink(v)) return webUrl(v);
      return mapsSearchUrl(v);
    }
    case "Meeting":
      // The word "form" opens the built-in request form; anything else must be an https booking link.
      if (isMeetingForm(v)) return MEETING_FORM_HREF;
      return meetingUrl(v);
    case "Custom": {
      // A custom button takes any link, email address or phone number.
      const scheme = schemeOf(v);
      if (scheme) return ALLOWED_SCHEMES.has(scheme) && !/[\u0000-\u001f<>"]/.test(v) ? v : null;
      if (/^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/.test(v)) return `mailto:${v}`;
      if (/^\+?[\d\s().-]{6,}$/.test(v) && v.replace(/\D/g, "").length >= 6) return `tel:${v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "")}`;
      return webUrl(v);
    }
    default:
      break;
  }

  const template = HANDLE_URL[kind];
  if (template) {
    if (!schemeOf(v) && !looksLikeDomain(v) && /^@?[\w.-]+$/.test(v)) {
      return template.replace("{h}", v.replace(/^@/, ""));
    }
    return webUrl(v);
  }
  if (NEEDS_FULL_LINK.has(kind) && !schemeOf(v) && !looksLikeDomain(v)) return null;
  return webUrl(v);
}
