// The typed API client, written by hand from the API contract.
import { runtimeT, type MessageKey } from "@/lib/i18n";
import { noteThrottle, parseRetryAfter, secondsLeft } from "@/lib/throttle";
// Browser calls go to this app's /api/proxy, which adds the signed-in token. One error type carries
// the contract's error fields (code, message, fields).
import type {
  Analytics, AuditPage, BulkResult, Card, CardPatch, ChangeRequest, ChangeStatus, Department, DepartmentDesign, FieldRules, Invoice, Lead,
  LeadSettings, LeadStatus, Member, MandatoryButton, Plan, Role, Subscription, User, WorkspaceDetail, WorkspaceSummary, Brand, BrandArtwork,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string[]>;
  /** Seconds to wait before trying again (429 throttled), 0 otherwise. */
  readonly retryAfter: number;

  constructor(status: number, code: string, message: string, fields: Record<string, string[]> = {}, retryAfter = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }

  /** The first message for one field, if the API sent any. */
  field(name: string): string | undefined {
    return this.fields[name]?.[0];
  }
}

/** True for the two errors that should show an upgrade prompt instead of a plain failure. */
export function isUpgradeError(e: unknown): e is ApiError {
  return e instanceof ApiError && (e.code === "plan_limit" || e.code === "subscription_required");
}

/** The API (or this app's own server) refused because the sign-in is too old for a sensitive change: ask for the password. */
export function isReauthError(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 403 && e.code === "reauth_required";
}

/** The company is waiting to be deleted: contacts, integrations and invites are closed. */
export function isClosedForDeletion(e: unknown): e is ApiError {
  return e instanceof ApiError && e.code === "workspace_pending_deletion";
}

/** The product team suspended the company: nobody can open it until it is restored. */
export function isSuspendedCompany(e: unknown): e is ApiError {
  return e instanceof ApiError && e.code === "workspace_suspended";
}

/** Turn a failed answer into an ApiError. Messages the app words itself (waiting, closed company, refused origin) are in the page's language. */
export function errorFromResponse(
  res: { status: number; headers: { get(name: string): string | null } },
  json: { error?: { code?: string; message?: string; fields?: Record<string, string[]> } } | null,
  fallback: MessageKey = "err.generic",
): ApiError {
  const code = json?.error?.code ?? "error";
  let message = json?.error?.message ?? runtimeT(fallback);
  const fields = json?.error?.fields ?? {};
  let retryAfter = 0;
  if (code === "network_error") message = runtimeT("err.unreachable");
  else if (code === "unauthorized" && res.status === 401) message = runtimeT("err.sessionExpired");
  else if (code === "origin_refused") message = runtimeT("err.originRefused");
  else if (code === "workspace_pending_deletion") message = runtimeT("err.pendingDeletion");
  else if (res.status === 429) {
    retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    noteThrottle(retryAfter);
    message = runtimeT("err.throttled", { n: retryAfter });
    return new ApiError(429, "throttled", message, fields, retryAfter);
  }
  return new ApiError(res.status, code, message, fields, retryAfter);
}

/** Thrown at once, without asking the server, while a "please wait" is running and a change is attempted. */
function waitingError(): ApiError | null {
  const n = secondsLeft();
  return n > 0 ? new ApiError(429, "throttled", runtimeT("err.throttled", { n }), {}, n) : null;
}
export { waitingError };

type Query = Record<string, string | number | boolean | undefined | null>;

interface Options {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  form?: FormData;
  query?: Query;
  /** Read the answer as text (CSV) instead of JSON. */
  text?: boolean;
}

function qs(q?: Query): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function request<T>(path: string, o: Options = {}): Promise<T> {
  const init: RequestInit = { method: o.method ?? "GET", credentials: "same-origin" };
  if (o.form) init.body = o.form;
  else if (o.body !== undefined) {
    init.body = JSON.stringify(o.body);
    init.headers = { "Content-Type": "application/json" };
  }
  // While the API has asked us to wait, a change is not even sent.
  if (init.method !== "GET") {
    const waiting = waitingError();
    if (waiting) throw waiting;
  }
  let res: Response;
  try {
    res = await fetch(`/api/proxy/${path}${qs(o.query)}`, init);
  } catch {
    throw new ApiError(0, "network_error", runtimeT("err.offline"));
  }
  if (!res.ok) {
    let json: Parameters<typeof errorFromResponse>[1] = null;
    try {
      json = (await res.json()) as typeof json;
    } catch {
      /* not JSON */
    }
    throw errorFromResponse(res, json);
  }
  if (res.status === 204) return undefined as T;
  return (o.text ? await res.text() : await res.json()) as T;
}

/** Sign in, register and accept-invite go through the cookie route, not the proxy. */
async function session<T>(action: string, body?: unknown): Promise<T> {
  if (action !== "logout") {
    const waiting = waitingError();
    if (waiting) throw waiting;
  }
  let res: Response;
  try {
    res = await fetch(`/api/session/${action}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, "network_error", runtimeT("err.offline"));
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: { code?: string; message?: string; fields?: Record<string, string[]> };
  };
  if (!res.ok) throw errorFromResponse(res, j);
  return j as T;
}

/** The company picture slots next to the logo, as the API spells them in the address. */
export type BrandPictureSlot = "symbol" | "background" | "template-front" | "template-back";

export interface ResolvedLink {
  url: string;
  title: string | null;
  favicon_url: string | null;
}

/** What a brand save may carry: partial updates merge, null clears the colours and the palette, artwork merges one level deeper. */
export type BrandPatch = Partial<Omit<Brand, "colours" | "palette" | "artwork" | "logo_url" | "symbol_url" | "background_url" | "template_front_url" | "template_back_url">> & {
  colours?: Brand["colours"];
  palette?: Brand["palette"];
  artwork?: { mode?: BrandArtwork["mode"]; background?: Partial<BrandArtwork["background"]>; pattern?: Partial<BrandArtwork["pattern"]>; template?: Partial<BrandArtwork["template"]> };
};

export interface MemberInvite {
  email: string;
  full_name?: string;
  title?: string;
  role?: Role;
  department_id?: string | null;
  /** Language of the invite e-mail. */
  language?: "en" | "ar" | "";
}

/** What happens to a card when its person is removed. */
export type CardPolicy = "keep" | "reassign" | "delete";

export interface BulkMemberBody {
  action: "publish" | "unpublish" | "suspend" | "restore" | "role" | "department" | "remove";
  ids: string[];
  role?: "admin" | "employee";
  department_id?: string | null;
  card?: CardPolicy;
  reassign_to?: string | null;
}
export interface BulkCardBody {
  action: "publish" | "unpublish" | "suspend" | "restore" | "delete";
  ids: string[];
}

export interface AuditQuery {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  page_size?: number;
}

export interface DepartmentBody {
  name?: string;
  design?: DepartmentDesign;
  items?: Pick<MandatoryButton, "kind" | "value" | "label">[];
  mandatory_items?: Pick<MandatoryButton, "kind" | "value" | "label">[];
}

/** A sign-in answers with the signed-in person, or (2-step verification) with a challenge to answer first. */
export type SignInResult = { user: User } | { mfa_required: true; mfa_token: string; methods: ("totp" | "recovery")[] };

export const api = {
  // auth
  login: (email: string, password: string) => session<SignInResult>("login", { email, password }),
  register: (email: string, password: string, full_name: string, language?: string) => session<{ user: User }>("register", { email, password, full_name, ...(language ? { language } : {}) }),
  logout: () => session<{ ok: true }>("logout"),
  me: () => request<User>("auth/me"),
  updateMe: (b: { full_name?: string; language?: string | null; product_updates?: boolean }) => request<User>("auth/me", { method: "PATCH", body: b }),
  forgot: (email: string) => request<void>("auth/forgot", { method: "POST", body: { email } }),
  reset: (token: string, password: string) => request<void>("auth/reset", { method: "POST", body: { token, password } }),
  /** The server stores the fresh tokens the API returns in the cookies, so the person stays signed in on this device. */
  changePassword: (old_password: string, new_password: string) =>
    request<void>("auth/change-password", { method: "POST", body: { old_password, new_password } }),
  /** Revoke every sign-in of this account on every device. The caller then clears this device with `logout`. */
  logoutAll: () => request<{ revoked: number }>("auth/logout-all", { method: "POST", body: {} }),
  workspaces: () => request<WorkspaceSummary[]>("me/workspaces"),

  // invites
  invite: (token: string) =>
    request<{ workspace_name: string; email: string; full_name: string; language?: string | null }>("invites/lookup", { method: "POST", body: { token } }),
  acceptInvite: (token: string, b: { password?: string; full_name?: string }) =>
    session<{ workspace_id: string } | { mfa_required: true; mfa_token: string; methods: ("totp" | "recovery")[]; workspace_id: string }>("accept-invite", { token, ...b }),

  // plans and billing
  plans: () => request<Plan[]>("plans"),
  checkout: (ws: string, plan_code: string, seats?: number) =>
    request<{ checkout_url: string }>(`workspaces/${ws}/checkout`, { method: "POST", body: { plan_code, seats } }),
  subscription: (ws: string) => request<Subscription>(`workspaces/${ws}/subscription`),
  invoices: (ws: string) => request<Invoice[]>(`workspaces/${ws}/invoices`),

  // workspaces
  createWorkspace: (name: string, country?: string) => request<WorkspaceDetail>("workspaces", { method: "POST", body: country ? { name, country } : { name } }),
  workspace: (ws: string) => request<WorkspaceDetail>(`workspaces/${ws}`),
  updateWorkspace: (ws: string, b: { name?: string; brand?: BrandPatch; custom_domain?: string | null; country?: string | null }) =>
    request<WorkspaceDetail>(`workspaces/${ws}`, { method: "PATCH", body: b }),
  uploadLogo: (ws: string, file: File | Blob) => {
    const f = new FormData();
    f.append("file", file, file instanceof File ? file.name : "logo.png");
    return request<{ logo_url: string }>(`workspaces/${ws}/logo`, { method: "POST", form: f });
  },
  deleteLogo: (ws: string) => request<void>(`workspaces/${ws}/logo`, { method: "DELETE" }),
  /** One of the company pictures: the symbol, the card background, or the template front or back. */
  uploadBrandPicture: (ws: string, slot: BrandPictureSlot, file: File | Blob) => {
    const f = new FormData();
    f.append("file", file, file instanceof File ? file.name : `${slot}.${file.type === "image/png" ? "png" : "jpg"}`);
    return request<Record<string, string>>(`workspaces/${ws}/${slot}`, { method: "POST", form: f });
  },
  deleteBrandPicture: (ws: string, slot: BrandPictureSlot) => request<void>(`workspaces/${ws}/${slot}`, { method: "DELETE" }),

  // cards
  cards: (ws: string) => request<Card[]>(`workspaces/${ws}/cards`),
  createCard: (ws: string, b: CardPatch = {}) => request<Card>(`workspaces/${ws}/cards`, { method: "POST", body: b }),
  card: (id: string) => request<Card>(`cards/${id}`),
  updateCard: (id: string, b: CardPatch) => request<Card>(`cards/${id}`, { method: "PATCH", body: b }),
  deleteCard: (id: string) => request<void>(`cards/${id}`, { method: "DELETE" }),
  uploadPhoto: (id: string, file: File) => {
    const f = new FormData();
    f.append("file", file);
    return request<{ photo_url: string | null; pending?: boolean; change_id?: string; message?: string }>(`cards/${id}/photo`, { method: "POST", form: f });
  },
  uploadCover: (id: string, file: File) => {
    const f = new FormData();
    f.append("file", file);
    return request<{ cover_url: string }>(`cards/${id}/cover`, { method: "POST", form: f });
  },
  uploadIcon: (id: string, file: File) => {
    const f = new FormData();
    f.append("file", file);
    return request<{ image_url: string }>(`cards/${id}/icon`, { method: "POST", form: f });
  },
  resolveLink: (url: string) => request<ResolvedLink>("tools/resolve-link", { method: "POST", body: { url } }),
  publishCard: (id: string) => request<Card>(`cards/${id}/publish`, { method: "POST" }),
  unpublishCard: (id: string) => request<Card>(`cards/${id}/unpublish`, { method: "POST" }),
  duplicateCard: (id: string) => request<Card>(`cards/${id}/duplicate`, { method: "POST" }),
  checkSlug: (slug: string) => request<{ available: boolean; suggestion: string | null }>("slugs/check", { query: { slug } }),

  // team
  members: (ws: string) => request<Member[]>(`workspaces/${ws}/members`),
  inviteMembers: (ws: string, invites: MemberInvite[]) => request<Member[]>(`workspaces/${ws}/invites`, { method: "POST", body: { invites } }),
  updateMember: (ws: string, id: string, b: { role?: Role; status?: "active" | "suspended" }) =>
    request<Member>(`workspaces/${ws}/members/${id}`, { method: "PATCH", body: b }),
  updateMemberDepartment: (ws: string, id: string, department_id: string | null) =>
    request<Member>(`workspaces/${ws}/members/${id}`, { method: "PATCH", body: { department_id } }),
  removeMember: (ws: string, id: string, o: { card?: CardPolicy; reassign_to?: string | null } = {}) =>
    request<void>(`workspaces/${ws}/members/${id}`, { method: "DELETE", body: o.card ? { card: o.card, reassign_to: o.reassign_to ?? null } : undefined }),
  resendInvite: (ws: string, id: string) => request<Member>(`workspaces/${ws}/members/${id}/resend-invite`, { method: "POST" }),
  importMembers: (ws: string, file: File) => {
    const f = new FormData();
    f.append("file", file);
    return request<{ created: number; skipped: { row: number; reason: string }[] }>(`workspaces/${ws}/members/import`, { method: "POST", form: f });
  },

  // company operations
  bulkMembers: (ws: string, b: BulkMemberBody) => request<BulkResult>(`workspaces/${ws}/bulk/members`, { method: "POST", body: b }),
  bulkCards: (ws: string, b: BulkCardBody) => request<BulkResult>(`workspaces/${ws}/bulk/cards`, { method: "POST", body: b }),
  reassignCard: (card: string, member_id: string | null, reset_details = false) =>
    request<Card>(`cards/${card}/reassign`, { method: "POST", body: { member_id, reset_details } }),
  audit: (ws: string, q: AuditQuery) => request<AuditPage>(`workspaces/${ws}/audit`, { query: { ...q } }),
  /** The address of the CSV export with the same filters (opened by the browser, which sends the sign-in cookie). */
  auditCsvUrl: (ws: string, q: AuditQuery) => `/api/proxy/workspaces/${ws}/audit.csv${qs({ ...q, page: undefined, page_size: undefined })}`,
  departments: (ws: string) => request<Department[]>(`workspaces/${ws}/departments`),
  createDepartment: (ws: string, b: DepartmentBody) => request<Department>(`workspaces/${ws}/departments`, { method: "POST", body: b }),
  updateDepartment: (ws: string, id: string, b: DepartmentBody) => request<Department>(`workspaces/${ws}/departments/${id}`, { method: "PATCH", body: b }),
  deleteDepartment: (ws: string, id: string) => request<void>(`workspaces/${ws}/departments/${id}`, { method: "DELETE" }),
  assignDepartment: (ws: string, id: string, member_ids: string[]) =>
    request<BulkResult>(`workspaces/${ws}/departments/${id}/assign`, { method: "POST", body: { member_ids } }),
  fieldRules: (ws: string) => request<FieldRules>(`workspaces/${ws}/field-rules`),
  updateFieldRules: (ws: string, b: Partial<FieldRules>) => request<FieldRules>(`workspaces/${ws}/field-rules`, { method: "PATCH", body: b }),
  changeRequests: (ws: string, status: ChangeStatus | "all" = "pending") =>
    request<{ count: number; pending_count: number; results: ChangeRequest[] }>(`workspaces/${ws}/change-requests`, { query: { status } }),
  decideChange: (ws: string, id: string, approve: boolean, reason?: string) =>
    request<ChangeRequest>(`workspaces/${ws}/change-requests/${id}/${approve ? "approve" : "reject"}`, { method: "POST", body: { reason } }),
  decideChanges: (ws: string, ids: string[], approve: boolean, reason?: string) =>
    request<BulkResult>(`workspaces/${ws}/change-requests/bulk`, { method: "POST", body: { action: approve ? "approve" : "reject", ids, reason } }),
  withdrawChange: (id: string) => request<{ id: string; status: string }>(`change-requests/${id}/withdraw`, { method: "POST" }),

  // leads
  leads: (ws: string, q: { card_id?: string; q?: string; status?: string; limit?: number; offset?: number }) =>
    request<{ count: number; results: Lead[] }>(`workspaces/${ws}/leads`, { query: q }),
  leadSettings: (ws: string) => request<LeadSettings>(`workspaces/${ws}/lead-settings`),
  updateLeadSettings: (ws: string, body: Partial<LeadSettings>) => request<LeadSettings>(`workspaces/${ws}/lead-settings`, { method: "PATCH", body }),
  addLead: (ws: string, body: { name: string; email?: string; phone?: string; company?: string; note?: string; card_id?: string; source?: "scanned_card" | "event"; tag?: string; event_name?: string; client_ref?: string }) =>
    request<Lead>(`workspaces/${ws}/leads`, { method: "POST", body }),
  updateLead: (id: string, status: LeadStatus) => request<Lead>(`leads/${id}`, { method: "PATCH", body: { status } }),
  leadsCsv: (ws: string) => request<string>(`workspaces/${ws}/leads.csv`, { text: true }),

  // analytics
  analytics: (ws: string, days: number, card_id?: string) => request<Analytics>(`workspaces/${ws}/analytics`, { query: { days, card_id } }),
};
