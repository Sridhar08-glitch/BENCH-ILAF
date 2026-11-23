// Public card calls: no sign-in needed. The page itself is fetched on the server;
// events and leads are sent straight from the visitor's browser to the API.
import { ApiError } from "./api";
import { API_PUBLIC_URL, API_SERVER_URL } from "./config";
import { runtimeT } from "./i18n";
import type { DirectoryPage, EventSource, EventType, PublicCardResponse } from "./types";

/** Fetch a public card on the server. Returns null for an unknown code (404). */
export async function fetchPublicCard(code: string): Promise<PublicCardResponse | null> {
  const res = await fetch(`${API_SERVER_URL}/public/cards/${encodeURIComponent(code)}`, {
    next: { revalidate: Number(process.env.PUBLIC_CARD_REVALIDATE ?? 15) },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Card request failed with ${res.status}`);
  return (await res.json()) as PublicCardResponse;
}

/** Fetch one page of a company directory on the server. Returns null when the directory is off or unknown (404). */
export async function fetchDirectory(slug: string, params: { q?: string; department?: string; page?: number }): Promise<DirectoryPage | null> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.department) sp.set("department", params.department);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  const res = await fetch(`${API_SERVER_URL}/public/directory/${encodeURIComponent(slug)}${qs ? `?${qs}` : ""}`, {
    next: { revalidate: Number(process.env.PUBLIC_CARD_REVALIDATE ?? 15) },
  });
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
