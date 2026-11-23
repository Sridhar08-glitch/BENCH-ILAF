// Plain HTML form posts to the API from the server (the pages that need no script): the visitor's address is forwarded
// so the API's per-address limits count the visitor, not this server.
import { API_SERVER_URL } from "@/lib/config";
import { visitorHeaders } from "@/lib/server/client-ip";

/** Fields of a submitted form as short trimmed strings (anything that is not text is dropped). */
export function textFields(form: FormData, names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const v = form.get(name);
    if (typeof v === "string") out[name] = v.trim().slice(0, 1000);
  }
  return out;
}

/** The reasons of a card report the API accepts. */
export const REPORT_REASONS = ["spam", "fake", "offensive", "impersonation", "other"] as const;

/** POST JSON to the API. Returns whether it was accepted. */
export async function postJson(path: string, body: unknown, headers: Headers, language: string | null): Promise<boolean> {
  try {
    const res = await fetch(`${API_SERVER_URL}${path}`, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", ...(language ? { "X-Language": language } : {}), ...visitorHeaders(headers) },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** A "303 See Other" back to a page of this site (a relative address, so it works behind any proxy). */
export function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}
