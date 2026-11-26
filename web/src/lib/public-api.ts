// Public card calls: no sign-in needed. The page itself is fetched on the server;
// events and leads are sent straight from the visitor's browser to the API.
import { ApiError } from "./api";
import { API_PUBLIC_URL, API_SERVER_URL } from "./config";
import { runtimeT } from "./i18n";
import type { DirectoryPage, EventSource, EventType, PublicCardResponse } from "./types";

/**
 * How long the server may keep a public card answer, in seconds. The default is 0: every visit asks the API, so a card
 * that was unpublished, paused or deleted disappears at once. The server only stores successful answers; the API answers
 * 404 for a hidden card, so a stored copy would never be replaced and the old card would stay on the page.
 * A value above 0 (PUBLIC_CARD_REVALIDATE) trades that for fewer API calls and is only safe for a short time.
 */
export function publicCardCacheInit(): RequestInit & { next?: { revalidate: number } } {
  const seconds = Number(process.env.PUBLIC_CARD_REVALIDATE ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? { next: { revalidate: seconds } } : { cache: "no-store" };
}

// ---------------------------------------------------------------- rich content under the card
// The sections a card owner adds below the card (see components/card/sections). Each kind carries its own `data`;
// the public API expands team cards, gallery images and products into `data` so the page needs no second call.

export type SectionKind = "video" | "products" | "hours" | "booking" | "team" | "gallery" | "event" | "map";
export const SECTION_KINDS: readonly SectionKind[] = ["video", "products", "hours", "booking", "team", "gallery", "event", "map"];
export type ProductsLayout = "grid" | "carousel" | "menu" | "listings";
export const PRODUCTS_LAYOUTS: readonly ProductsLayout[] = ["grid", "carousel", "menu", "listings"];

/** One day of opening hours. `d` counts from Monday (0) to Sunday (6); times are "HH:MM" in the section's time zone. */
export interface HoursDay {
  d: number;
  open: string;
  close: string;
  closed: boolean;
}

export interface VideoSectionData { title: string }
export interface HoursSectionData { title: string; timezone: string; days: HoursDay[]; note: string }
export interface BookingSectionData { title: string }
export interface EventSectionData {
  title: string;
  event_name: string;
  /** ISO date-time; the countdown runs towards it. */
  starts_at: string;
  ends_at: string | null;
  venue: string;
  hall: string;
  stand: string;
  talk_title: string;
  talk_time: string;
  slides_url: string;
}
export interface MapSectionData { title: string; address: string; maps_url: string; directions_note: string }

/** A product as the public page receives it inside a products section. */
export interface PublicProduct {
  id: string;
  title: string;
  description: string;
  /** Decimal as text ("320.00") or a number. */
  price: string | number;
  currency: string;
  image_url: string | null;
  badge: string;
  /** Free fields: beds, baths, size for listings; category for menus; tags. */
  meta: Record<string, unknown>;
  stock?: number | null;
  /** The API answers this instead of the stock figure: true when nothing is left. */
  sold_out?: boolean;
}
export interface ProductsSectionData { title: string; layout: ProductsLayout; items?: PublicProduct[] }

/** A colleague's card inside a team section (expanded by the API from the public code). */
export interface TeamMember { code: string; name: string; title: string; photo_url: string | null; url: string }
export interface TeamSectionData {
  title: string;
  /** Expanded members on the public page; the editor sends public codes instead. */
  cards: TeamMember[];
}
export interface GalleryImage { id: string; url: string; caption: string; order: number }
export interface GallerySectionData { title: string; images?: GalleryImage[] }

export type SectionData = {
  video: VideoSectionData;
  products: ProductsSectionData;
  hours: HoursSectionData;
  booking: BookingSectionData;
  team: TeamSectionData;
  gallery: GallerySectionData;
  event: EventSectionData;
  map: MapSectionData;
};

export type PublicSection = { [K in SectionKind]: { id: string; kind: K; order: number; data: SectionData[K] } }[SectionKind];

/** The rich fields of a live card (all optional: an older API answer simply has none). */
export interface PublicRichContent {
  bio?: string;
  video_url?: string | null;
  video_poster_url?: string | null;
  sections?: PublicSection[];
}

export type PublicCardWithContent = PublicCardResponse extends infer R
  ? R extends { state: "live"; card: infer C }
    ? Omit<R, "card"> & { card: C & PublicRichContent }
    : R
  : never;

/** Fetch a public card on the server. Returns null for an unknown code (404). */
export async function fetchPublicCard(code: string, customHost?: string | null): Promise<PublicCardWithContent | null> {
  // On a company's own domain the API is told which one (?host=) and answers 404 for any card that is not that company's.
  const scope = customHost ? `?host=${encodeURIComponent(customHost)}` : "";
  const res = await fetch(`${API_SERVER_URL}/public/cards/${encodeURIComponent(code)}${scope}`, publicCardCacheInit());
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Card request failed with ${res.status}`);
  return (await res.json()) as PublicCardWithContent;
}

/** Fetch one page of a company directory on the server. Returns null when the directory is off or unknown (404). */
export async function fetchDirectory(slug: string, params: { q?: string; department?: string; page?: number }, customHost?: string | null): Promise<DirectoryPage | null> {
  const sp = new URLSearchParams();
  if (customHost) sp.set("host", customHost);
  if (params.q) sp.set("q", params.q);
  if (params.department) sp.set("department", params.department);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  const res = await fetch(`${API_SERVER_URL}/public/directory/${encodeURIComponent(slug)}${qs ? `?${qs}` : ""}`, publicCardCacheInit());
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Directory request failed with ${res.status}`);
  return (await res.json()) as DirectoryPage;
}

/** Report a view, tap, save or link click without ever delaying the visitor. */
export function sendEvent(code: string, type: EventType, source?: EventSource | null, kind?: string): void {
  try {
    void fetch(`${API_PUBLIC_URL}/public/cards/${encodeURIComponent(code)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...(source ? { source } : {}), ...(kind ? { kind } : {}) }),
      keepalive: true,
      mode: "cors",
      credentials: "omit",
    }).catch(() => undefined);
  } catch {
    /* tracking must never break the card */
  }
}

export interface LeadInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  note?: string;
  /** The visitor ticked the consent box. */
  consent: boolean;
  /** When the form was opened (milliseconds since 1970): a form sent within a second or two is refused. */
  opened_at: number;
  /** How the visitor reached the card (nfc, qr, link, email). */
  source?: EventSource | null;
  /** Honeypot: real visitors never fill this in. */
  website_url: string;
}

export interface MeetingRequestInput {
  name: string;
  email: string;
  phone?: string;
  /** One to three times that suit the visitor, as typed. */
  times: string[];
  message?: string;
  consent: boolean;
  opened_at: number;
  source?: EventSource | null;
  website_url: string;
}

async function postForm(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
  });
  if (!res.ok) {
    let code = "error";
    let message = runtimeT("card.sendFailed");
    let fields: Record<string, string[]> = {};
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string; fields?: Record<string, string[]> } };
      const body = j.error ?? {};
      code = body.code ?? code;
      message = body.message ?? message;
      fields = body.fields ?? {};
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, code, message, fields, Number(res.headers.get("retry-after")) || 0);
  }
  return res.json().catch(() => ({}));
}

/** Share the visitor's details with the card owner. Returns the owner's contact file address. */
export async function sendLead(code: string, lead: LeadInput): Promise<{ vcard_url?: string }> {
  return (await postForm(`${API_PUBLIC_URL}/public/cards/${encodeURIComponent(code)}/leads`, lead)) as { vcard_url?: string };
}

/** Ask the card owner for a meeting through the built-in form. */
export async function sendMeetingRequest(code: string, req: MeetingRequestInput): Promise<void> {
  await postForm(`${API_PUBLIC_URL}/public/cards/${encodeURIComponent(code)}/meeting-requests`, req);
}

/** Read the contact file so the Save sheet can show exactly what will be added. */
export async function fetchVcardText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: "omit" });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}
