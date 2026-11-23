// The Meeting button: either the person's own booking page (Calendly, Google Calendar, Cal.com,
// Microsoft Bookings or any https link) or the built-in request form (the value is the word "form").
// Pure functions, mirrored by the API.
import type { TFunction } from "@/lib/i18n";

/** A Meeting button holding this word opens the built-in request form. */
export const MEETING_FORM = "form";
/** The link a form-mode button has on the card page; the page catches the tap and opens the form. */
export const MEETING_FORM_HREF = "#meeting-request";

/** Booking pages with their own name. The first matching host suffix wins. */
export const MEETING_PROVIDERS: { host: string; name: string; brand: string }[] = [
  { host: "calendly.com", name: "Calendly", brand: "calendly" },
  { host: "calendar.app.google", name: "Google Calendar", brand: "googlecalendar" },
  { host: "calendar.google.com", name: "Google Calendar", brand: "googlecalendar" },
  { host: "cal.com", name: "Cal.com", brand: "caldotcom" },
  { host: "outlook.office365.com", name: "Microsoft Bookings", brand: "microsoftoutlook" },
  { host: "outlook.office.com", name: "Microsoft Bookings", brand: "microsoftoutlook" },
  { host: "bookings.microsoft.com", name: "Microsoft Bookings", brand: "microsoftoutlook" },
  { host: "book.ms", name: "Microsoft Bookings", brand: "microsoftoutlook" },
  { host: "tidycal.com", name: "TidyCal", brand: "tidycal" },
  { host: "savvycal.com", name: "SavvyCal", brand: "savvycal" },
  { host: "meetings.hubspot.com", name: "HubSpot Meetings", brand: "hubspot" },
  { host: "zoom.us", name: "Zoom Scheduler", brand: "zoom" },
];

export function isMeetingForm(value: string): boolean {
  return value.trim().toLowerCase() === MEETING_FORM;
}

/** The https address of a booking link, or null when it is not one (http, other schemes, no real host). */
export function meetingUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  const hostPort = /^[^/?#:]+:\d+(?:[/?#]|$)/.test(v);
  if (scheme && !hostPort && scheme[1].toLowerCase() !== "https") return null;
  const full = scheme && !hostPort ? v : `https://${v.replace(/^\/+/, "")}`;
  try {
    const u = new URL(full);
    if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) return null;
    return full;
  } catch {
    return null;
  }
}

/** The recognised booking provider of a link, or null. */
export function meetingProvider(raw: string): { name: string; brand: string } | null {
  const url = meetingUrl(raw);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase();
  const hit = MEETING_PROVIDERS.find((p) => host === p.host || host.endsWith(`.${p.host}`));
  return hit ? { name: hit.name, brand: hit.brand } : null;
}

/** Why a Meeting value cannot be used, in plain words, or null when it is fine (an empty value is fine: the button stays hidden). */
export function meetingProblem(raw: string, t?: TFunction): string | null {
  const v = raw.trim();
  if (!v || isMeetingForm(v)) return null;
  if (/^http:\/\//i.test(v)) return t ? t("editor.meetHttps") : "Use a link that starts with https://.";
  return meetingUrl(v) ? null : t ? t("editor.meetAddress") : "Enter the web address of your booking page, such as https://calendly.com/yourname.";
}
