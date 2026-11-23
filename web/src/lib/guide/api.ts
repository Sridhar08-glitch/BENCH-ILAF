// API calls for the guide progress (GET and PUT /api/v1/guide/progress) and the page-side announcements.
import { ApiError, errorFromResponse, waitingError } from "../api";
import { runtimeT } from "../i18n";
import type { ProgressItem, ProgressState } from "./types";

export type ProgressChange = { guide_id: string; step_id: string; state: ProgressState | "reset" };

async function call<T>(method: "GET" | "PUT", body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  if (method !== "GET") {
    const waiting = waitingError();
    if (waiting) throw waiting;
  }
  let res: Response;
  try {
    res = await fetch("/api/proxy/guide/progress", init);
  } catch {
    throw new ApiError(0, "network_error", runtimeT("err.offline"));
  }
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw errorFromResponse(res, json as Parameters<typeof errorFromResponse>[1]);
  return json as T;
}

export const guideApi = {
  progress: async (): Promise<ProgressItem[]> => (await call<{ items: ProgressItem[] }>("GET")).items ?? [],
  save: (changes: ProgressChange[]) => call<{ items: ProgressItem[] }>("PUT", { items: changes }),
};

// ---- announcements: a page tells the guide that something happened, without importing it

export const GUIDE_EVENT = "bench:guide-event";
export const NEW_COMPANY_EVENT = "bench:new-company";
export const TOUR_EVENT = "bench:start-tour";
export const WELCOME_EVENT = "bench:replay-welcome";

/** A page says "a card was published" (and so on); the guide decides whether to show a prompt. Safe on the server. */
export function announce(event: "card_published" | "first_invite_sent" | "brand_saved" | "first_lead" | "export_done"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GUIDE_EVENT, { detail: event }));
}

/** Records that the browser saw something a step depends on, for example "signature_copied". */
export function announceFlag(flag: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GUIDE_EVENT, { detail: `flag:${flag}` }));
}
