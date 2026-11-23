// The support API: tickets, the public contact form, live chat and the staff calls. Everything goes through /api/proxy.
// Errors are shown by code (apiErrorText), never as the raw server sentence.
import { ApiError, errorFromResponse, waitingError } from "@/lib/api";
import { staffToken } from "@/lib/designs/api";
import type {
  Canned, ChatPoll, ChatStarted, ChatStatus, Metrics, Presence, StaffChat, StaffInbox, StaffTicketDetail, SupportContext, SupportSettings, TicketDetail,
  TicketSummary,
} from "./types";

interface CallOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  form?: FormData;
  staff?: boolean;
  query?: Record<string, string | number | undefined | null>;
  headers?: Record<string, string>;
  text?: boolean;
}

function qs(q?: CallOptions["query"]): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** One request. Resolves with the parsed body and the response headers (a 304 gives `notModified`). */
async function send<T>(path: string, o: CallOptions = {}): Promise<{ data: T; notModified: boolean; etag: string | null }> {
  const method = o.method ?? "GET";
  if (method !== "GET") {
    const waiting = waitingError();
    if (waiting) throw waiting;
  }
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  const init: RequestInit = { method, credentials: "same-origin" };
  if (o.form) init.body = o.form;
  else if (o.body !== undefined) {
    init.body = JSON.stringify(o.body);
    headers["Content-Type"] = "application/json";
  }
  if (o.staff) {
    const token = staffToken.get();
    if (token) headers["X-Staff-Token"] = token;
  }
  init.headers = headers;
  let res: Response;
  try {
    res = await fetch(`/api/proxy/${path}${qs(o.query)}`, init);
  } catch {
    throw new ApiError(0, "network_error", "");
  }
  if (res.status === 304) return { data: undefined as T, notModified: true, etag: res.headers.get("etag") };
  if (!res.ok) {
    let json: Parameters<typeof errorFromResponse>[1] = null;
    try {
      json = (await res.json()) as typeof json;
    } catch {
      /* not JSON */
    }
    throw errorFromResponse(res, json);
  }
  const etag = res.headers.get("etag");
  if (res.status === 204) return { data: undefined as T, notModified: false, etag };
  return { data: (o.text ? await res.text() : await res.json()) as T, notModified: false, etag };
}

const call = async <T,>(path: string, o?: CallOptions): Promise<T> => (await send<T>(path, o)).data;

export interface NewTicket {
  category: string;
  subject: string;
  body: string;
  include_context: boolean;
  context?: SupportContext;
  workspace_id?: string;
  files?: File[];
}

function ticketForm(b: NewTicket): FormData {
  const f = new FormData();
  f.set("category", b.category);
  f.set("subject", b.subject);
  f.set("body", b.body);
  f.set("include_context", b.include_context ? "true" : "false");
  if (b.context) f.set("context", JSON.stringify(b.context));
  if (b.workspace_id) f.set("workspace_id", b.workspace_id);
  for (const file of b.files ?? []) f.append("files", file);
  return f;
}

function messageForm(body: string, files: File[]): FormData {
  const f = new FormData();
  f.set("body", body);
  for (const file of files) f.append("files", file);
  return f;
}

export interface ContactInput {
  name: string;
  email: string;
  category: string;
  subject: string;
  body: string;
  challenge: string;
  counter: number;
  website: string;
  context?: SupportContext;
}

export const supportApi = {
  summary: () => call<{ unread: number; open: number }>("support/summary"),
  tickets: (status?: string) => call<TicketSummary[]>("support/tickets", { query: { status } }),
  ticket: (id: string) => call<TicketDetail>(`support/tickets/${id}`),
  create: (b: NewTicket) => call<TicketDetail>("support/tickets", { method: "POST", form: ticketForm(b) }),
  seen: (id: string) => call<{ ok: boolean }>(`support/tickets/${id}/seen`, { method: "POST" }),
  reply: (id: string, body: string, files: File[]) => call<TicketDetail>(`support/tickets/${id}/messages`, { method: "POST", form: messageForm(body, files) }),
  solve: (id: string) => call<TicketDetail>(`support/tickets/${id}/solve`, { method: "POST" }),
  reopen: (id: string) => call<TicketDetail>(`support/tickets/${id}/reopen`, { method: "POST" }),
  rate: (id: string, rating: number, comment: string) => call<TicketDetail>(`support/tickets/${id}/rating`, { method: "POST", body: { rating, comment } }),
  fileUrl: (ticket: string, file: string) => `/api/proxy/support/tickets/${ticket}/files/${file}/download`,
  challenge: () => call<{ challenge: string; difficulty: number; min_wait: number }>("support/challenge"),
  contact: (b: ContactInput) => call<{ number: number; label: string }>("support/contact", { method: "POST", body: b }),
};

/** Chat calls for a visitor: the token of a signed-out visitor travels in a header, a signed-in person is known by the cookie. */
const tokenHeader = (token?: string | null): Record<string, string> => (token ? { "X-Chat-Token": token } : {});

export const chatApi = {
  status: (workspace?: string) => call<ChatStatus>("support/chat/status", { query: { workspace } }),
  start: (b: { name?: string; email?: string; message?: string; context?: SupportContext }) => call<ChatStarted>("support/chat/start", { method: "POST", body: b }),
  poll: (id: string, since: number, token: string | null, etag: string | null) =>
    send<ChatPoll>(`support/chat/${id}/messages`, { query: { since }, headers: { ...tokenHeader(token), ...(etag ? { "If-None-Match": etag } : {}) } }),
  send: (id: string, body: string, files: File[], token: string | null) =>
    files.length
      ? call<{ id: number }>(`support/chat/${id}/messages`, { method: "POST", form: messageForm(body, files), headers: tokenHeader(token) })
      : call<{ id: number }>(`support/chat/${id}/messages`, { method: "POST", body: { body }, headers: tokenHeader(token) }),
  typing: (id: string, token: string | null) => call<{ ok: boolean }>(`support/chat/${id}/typing`, { method: "POST", headers: tokenHeader(token) }),
  end: (id: string, token: string | null) => call<{ status: string }>(`support/chat/${id}/end`, { method: "POST", headers: tokenHeader(token) }),
  fileUrl: (id: string, file: string) => `/api/proxy/support/chat/${id}/files/${file}/download`,
};

// ---------------------------------------------------------------- staff
export interface InboxQuery { tab?: string; status?: string; priority?: string; category?: string; channel?: string; workspace?: string; assignee?: string; sla?: string; from?: string; to?: string; q?: string; page?: number }

export const staffSupportApi = {
  inbox: (q: InboxQuery) => call<StaffInbox>("staff/support/tickets", { staff: true, query: { ...q } }),
  ticket: (id: string) => call<StaffTicketDetail>(`staff/support/tickets/${id}`, { staff: true }),
  update: (id: string, body: Record<string, unknown>) => call<StaffTicketDetail>(`staff/support/tickets/${id}`, { method: "PATCH", body, staff: true }),
  reply: (id: string, b: { body: string; internal: boolean; status?: string; canned_id?: number }, files: File[]) => {
    const f = new FormData();
    f.set("body", b.body);
    f.set("internal", b.internal ? "true" : "false");
    if (b.status) f.set("status", b.status);
    if (b.canned_id) f.set("canned_id", String(b.canned_id));
    for (const file of files) f.append("files", file);
    return call<StaffTicketDetail>(`staff/support/tickets/${id}/reply`, { method: "POST", form: f, staff: true });
  },
  merge: (id: string, into: string) => call<StaffTicketDetail>(`staff/support/tickets/${id}/merge`, { method: "POST", body: { into }, staff: true }),
  bulk: (ids: string[], action: string, value?: string) => call<{ changed: number }>("staff/support/tickets/bulk", { method: "POST", body: { ids, action, value }, staff: true }),
  startChat: (id: string) => call<StaffChat>(`staff/support/tickets/${id}/start-chat`, { method: "POST", staff: true }),
  exportCsv: (q: InboxQuery) => call<string>("staff/support/tickets.csv", { staff: true, query: { ...q }, text: true }),
  /** A file is fetched with the staff token (a plain link could not send it) and opened from a temporary address. */
  openFile: async (path: string): Promise<void> => {
    const token = staffToken.get();
    const res = await fetch(`/api/proxy/${path}`, { credentials: "same-origin", headers: token ? { "X-Staff-Token": token } : {} });
    if (!res.ok) throw errorFromResponse(res, null);
    const url = URL.createObjectURL(await res.blob());
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  agents: () => call<(StaffInbox["agents"][number] & { presence: string; capacity: number })[]>("staff/support/agents", { staff: true }),
  canned: () => call<Canned[]>("staff/support/canned", { staff: true }),
  saveCanned: (c: Partial<Canned> & { title: string; body_en: string }) =>
    call<Canned>(c.id ? `staff/support/canned/${c.id}` : "staff/support/canned", { method: c.id ? "PUT" : "POST", body: c, staff: true }),
  deleteCanned: (id: number) => call<void>(`staff/support/canned/${id}`, { method: "DELETE", staff: true }),
  chats: () => call<{ chats: StaffChat[]; recent: StaffChat[]; presence: Presence; availability: ChatStatus }>("staff/support/chats", { staff: true }),
  chat: (id: string, since: number) => call<StaffChat & ChatPoll & { read_id: number }>(`staff/support/chats/${id}`, { staff: true, query: { since } }),
  chatAction: (id: string, action: "accept" | "typing" | "end" | "convert") => call<StaffChat>(`staff/support/chats/${id}/${action}`, { method: "POST", staff: true }),
  chatSend: (id: string, body: string) => call<{ id: number }>(`staff/support/chats/${id}/messages`, { method: "POST", body: { body }, staff: true }),
  chatTransfer: (id: string, to: string) => call<StaffChat>(`staff/support/chats/${id}/transfer`, { method: "POST", body: { to }, staff: true }),
  setPresence: (status: string, capacity?: number) => call<Presence>("staff/support/presence", { method: "POST", body: { status, capacity }, staff: true }),
  heartbeat: () => call<{ status: string }>("staff/support/presence/heartbeat", { method: "POST", staff: true }),
  ban: (b: { chat_id?: string; ticket_id?: string; days: number; reason: string }) => call<{ id: number }>("staff/support/bans", { method: "POST", body: b, staff: true }),
  bans: () => call<{ id: number; ip_hash: string; reason: string; expires_at: string }[]>("staff/support/bans", { staff: true }),
  unban: (id: number) => call<void>(`staff/support/bans/${id}`, { method: "DELETE", staff: true }),
  metrics: (days: number) => call<Metrics>("staff/support/metrics", { staff: true, query: { days } }),
  settings: () => call<SupportSettings>("staff/support/settings", { staff: true }),
  saveSettings: (body: Partial<SupportSettings>) => call<SupportSettings>("staff/support/settings", { method: "PUT", body, staff: true }),
};
