// The new-contacts bell in the top bar: what the server says, and how the count and the label are shown.
import { ApiError, errorFromResponse, waitingError } from "./api";
import { runtimeT } from "./i18n";

export type BellKind = "contact" | "meeting_request";

export interface BellItem {
  id: string;
  name: string;
  card_name: string;
  source: string;
  created_at: string;
  kind: BellKind;
}

export interface BellData {
  unread: number;
  latest: BellItem[];
}

/** The count is shown up to this number; more reads "99+". */
export const BELL_CAP = 99;
/** How often the bell asks the server while the tab is visible. */
export const BELL_POLL_MS = 60_000;

export const bellKey = (ws: string) => ["lead-bell", ws] as const;

/** What the badge shows: nothing for no news, otherwise the count and whether it passed the cap. */
export function bellBadge(unread: number | undefined | null): { value: number; over: boolean } | null {
  const n = Math.floor(Number(unread));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > BELL_CAP ? { value: BELL_CAP, over: true } : { value: n, over: false };
}

/** Asks again only while the tab is visible and the workspace is open to the person. */
export function bellInterval(open: boolean, hidden: boolean): number | false {
  return open && !hidden ? BELL_POLL_MS : false;
}

/** The sentence for one contact: a meeting request says so, anything else is a shared contact. */
export function bellItemKey(kind: BellKind): "shell.bell.wouldMeet" | "shell.bell.shared" {
  return kind === "meeting_request" ? "shell.bell.wouldMeet" : "shell.bell.shared";
}

export function onContactsPage(pathname: string): boolean {
  return pathname === "/app/contacts" || pathname.startsWith("/app/contacts/");
}

async function call<T>(method: "GET" | "POST", path: string): Promise<T> {
  if (method !== "GET") {
    const waiting = waitingError();
    if (waiting) throw waiting;
  }
  let res: Response;
  try {
    res = await fetch(`/api/proxy/${path}`, { method, credentials: "same-origin" });
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

export const bellApi = {
  get: (ws: string) => call<BellData>("GET", `workspaces/${ws}/lead-bell`),
  seen: (ws: string) => call<unknown>("POST", `workspaces/${ws}/lead-bell/seen`),
};
