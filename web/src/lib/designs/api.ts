// The client of the custom design API: the company's requests, its own faces, and the staff area. Every call goes through
// this app's /api/proxy. Errors are shown by their code through the message files (see errorText), never as raw sentences.
import { ApiError, errorFromResponse } from "@/lib/api";
import { tk, type MessageKey, type TFunction } from "@/lib/i18n";
import { apiFieldText } from "@/lib/i18n/api-error";
import type { CompanyFace, CustomFaceData } from "@/lib/library/custom/types";
import type { CompanyBrand } from "@/lib/library/types";
import type { SanitizeWarning } from "@/lib/library/custom/sanitize";

export const REQUEST_STATUSES = ["new", "contacted", "in_design", "in_review", "changes_requested", "approved", "live", "closed", "withdrawn"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
/** The line the company sees: the path of a request that goes well. */
export const TIMELINE: RequestStatus[] = ["new", "contacted", "in_design", "in_review", "approved", "live"];

export interface RequestFile { id: string; name: string; content_type: string; size: number; by: string; message_id: string | null; created_at: string }
export interface ThreadMessage {
  id: string; kind: "message" | "status"; author_kind: "customer" | "staff" | "system"; author_name: string; body: string;
  status_to: string; created_at: string; files: RequestFile[]; internal?: boolean;
}
export interface RequestSummary {
  id: string; status: RequestStatus; goals: string; languages: string; deadline: string | null; created_at: string; updated_at: string;
  unread: number; follows_face_id: number | null; face: { id: number; name: string; status: string } | null;
}
export interface RequestDetail extends RequestSummary {
  brand_assets_notes: string; style_examples: string[]; employees_count: number | null; notes: string; allow_team_names: boolean; requested_by: string;
  messages: ThreadMessage[]; files: RequestFile[]; can_review: boolean; can_withdraw: boolean;
}
export interface BriefInput {
  goals: string; brand_assets_notes: string; style_examples: string[]; languages: "en" | "ar" | "both"; deadline: string | null;
  employees_count: number | null; notes: string; allow_team_names: boolean; follows_face?: number | null;
}
export interface PreviewPayload {
  face: CustomFaceData; status: string; company: { name: string; brand: Record<string, unknown> & { company_name: string } };
  people: { name: string; title: string }[] | null; sample_items: { kind: string; value: string }[]; expires_at?: string;
}

// ---------------------------------------------------------------- staff shapes
export interface StaffMe {
  id: string; email: string; full_name: string; staff_role: "read_only" | "support" | "admin"; totp_enrolled: boolean; verified: boolean;
  verified_until: string | null; recovery_codes_left: number;
}
export interface StaffPerson { id: string; email: string; full_name: string }
export interface BoardRow {
  id: string; status: RequestStatus; company: { id: string; name: string }; goals: string; languages: string; deadline: string | null;
  assigned: StaffPerson | null; created_at: string; updated_at: string; waiting_for_staff: boolean; face: { id: number; name: string; status: string } | null;
}
export interface Board { count: number; page: number; pages: number; results: BoardRow[]; counts: Record<string, number>; staff: StaffPerson[] }
export interface CompanySummary {
  id: string; name: string; plan: string | null; seats_used: number; seats_total: number; status: string; owner_email: string;
  logo_url: string | null; palette: unknown; colours: unknown; website: string;
}
export interface StaffRequestDetail extends BoardRow {
  brand_assets_notes: string; style_examples: string[]; employees_count: number | null; notes: string; allow_team_names: boolean;
  requested_by: string; follows_face_id: number | null; company_detail: CompanySummary; messages: ThreadMessage[]; files: RequestFile[];
  faces: { id: number; name: string; status: string; version: number; updated_at: string }[]; moves: RequestStatus[];
}
export interface StudioFace extends CustomFaceData {
  status: "draft" | "in_review" | "approved" | "live" | "disabled"; workspace_id: string; warnings: SanitizeWarning[];
  company: CompanySummary; request: BoardRow | null; affected_cards: number; updated_at: string;
  versions: { number: number; name: string; note: string; created_at: string; by: string }[];
  previews: { id: string; state: "active" | "expired" | "revoked"; expires_at: string; views: number; created_at: string }[];
}
export interface StaffAuditRow {
  id: string; actor_email: string; actor_role: string; action: string; label: string; target_type: string; target_id: string;
  target_label: string; details: Record<string, unknown>; created_at: string;
}
export interface Starter { key: string; name: string; tags: string[]; template: string; css: string; palettes: CustomFaceData["palettes"] }
export interface StaffCompanyRow { id: string; name: string; plan: string | null; seats_used: number; seats_total: number; status: string; owner_email: string; open_design_requests: number }

// ---------------------------------------------------------------- transport
const TOKEN_KEY = "bench_staff_token";
export const staffToken = {
  get(): string | null { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(v: string) { try { sessionStorage.setItem(TOKEN_KEY, v); } catch { /* private window: the person verifies again */ } },
  clear() { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* nothing stored */ } },
};

export async function call<T>(path: string, o: { method?: string; body?: unknown; form?: FormData; staff?: boolean; query?: Record<string, string | undefined> } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const init: RequestInit = { method: o.method ?? "GET", credentials: "same-origin" };
  if (o.form) init.body = o.form;
  else if (o.body !== undefined) { init.body = JSON.stringify(o.body); headers["Content-Type"] = "application/json"; }
  const tok = o.staff ? staffToken.get() : null;
  if (tok) headers["X-Staff-Token"] = tok;
  init.headers = headers;
  const qs = o.query ? "?" + new URLSearchParams(Object.entries(o.query).filter(([, v]) => v) as [string, string][]).toString() : "";
  let res: Response;
  try { res = await fetch(`/api/proxy/${path}${qs}`, init); } catch { throw new ApiError(0, "network_error", ""); }
  if (!res.ok) {
    let json: Parameters<typeof errorFromResponse>[1] = null;
    try { json = (await res.json()) as typeof json; } catch { /* not JSON */ }
    throw errorFromResponse(res, json);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const W = (ws: string) => `workspaces/${ws}/design-requests`;
export const designsApi = {
  requests: (ws: string) => call<RequestSummary[]>(W(ws)),
  request: (ws: string, id: string) => call<RequestDetail>(`${W(ws)}/${id}`),
  create: (ws: string, body: BriefInput) => call<RequestDetail>(W(ws), { method: "POST", body }),
  summary: (ws: string) => call<{ unread: number; open: number; in_review: number }>(`${W(ws)}/summary`),
  seen: (ws: string, id: string) => call<void>(`${W(ws)}/${id}/seen`, { method: "POST" }),
  message: (ws: string, id: string, body: string, file_ids: string[]) => call<RequestDetail>(`${W(ws)}/${id}/messages`, { method: "POST", body: { body, file_ids } }),
  upload: (ws: string, id: string, file: File) => { const f = new FormData(); f.set("file", file); return call<RequestFile>(`${W(ws)}/${id}/files`, { method: "POST", form: f }); },
  withdraw: (ws: string, id: string) => call<RequestDetail>(`${W(ws)}/${id}/withdraw`, { method: "POST" }),
  approve: (ws: string, id: string) => call<RequestDetail>(`${W(ws)}/${id}/approve`, { method: "POST" }),
  requestChanges: (ws: string, id: string, comment: string) => call<RequestDetail>(`${W(ws)}/${id}/request-changes`, { method: "POST", body: { comment } }),
  preview: (ws: string, id: string) => call<PreviewPayload>(`${W(ws)}/${id}/preview`),
  faces: (ws: string) => call<CompanyFace[]>(`workspaces/${ws}/custom-faces`),
  fileUrl: (ws: string, id: string, file: string) => `/api/proxy/${W(ws)}/${id}/files/${file}/download`,
};

export const staffApi = {
  me: () => call<StaffMe>("staff/me", { staff: true }),
  enrol: () => call<{ secret: string; otpauth_uri: string; qr_payload: string; issuer: string; account: string }>("staff/totp/enrol", { method: "POST", body: {} }),
  confirm: (code: string) => call<{ recovery_codes: string[]; token: string; expires_at: string }>("staff/totp/confirm", { method: "POST", body: { code } }),
  verify: (b: { code?: string; recovery_code?: string }) => call<{ token: string; expires_at: string; method: string; recovery_codes_left: number }>("staff/verify", { method: "POST", body: b }),
  newRecoveryCodes: () => call<{ recovery_codes: string[] }>("staff/recovery-codes", { method: "POST", body: {}, staff: true }),
  logout: () => call<void>("staff/logout", { method: "POST", staff: true }),
  audit: (q: Record<string, string | undefined>) => call<{ count: number; page: number; pages: number; results: StaffAuditRow[]; actions: { key: string; label: string }[] }>("staff/audit", { staff: true, query: q }),
  companies: (q: Record<string, string | undefined>) => call<{ count: number; page: number; pages: number; results: StaffCompanyRow[] }>("staff/companies", { staff: true, query: q }),
  board: (q: Record<string, string | undefined>) => call<Board>("staff/design-requests", { staff: true, query: q }),
  request: (id: string) => call<StaffRequestDetail>(`staff/design-requests/${id}`, { staff: true }),
  message: (id: string, body: string, internal: boolean, file_ids: string[]) => call<ThreadMessage>(`staff/design-requests/${id}/messages`, { method: "POST", body: { body, internal, file_ids }, staff: true }),
  upload: (id: string, file: File) => { const f = new FormData(); f.set("file", file); return call<RequestFile>(`staff/design-requests/${id}/files`, { method: "POST", form: f, staff: true }); },
  setStatus: (id: string, status: string, note: string) => call<StaffRequestDetail>(`staff/design-requests/${id}/status`, { method: "POST", body: { status, note }, staff: true }),
  assign: (id: string, staff_id: string | null) => call<StaffRequestDetail>(`staff/design-requests/${id}/assign`, { method: "POST", body: { staff_id }, staff: true }),
  createFace: (id: string, starter: string | null) => call<StudioFace>(`staff/design-requests/${id}/faces`, { method: "POST", body: { starter }, staff: true }),
  starters: () => call<Starter[]>("staff/starters", { staff: true }),
  face: (id: number) => call<StudioFace>(`staff/faces/${id}`, { staff: true }),
  saveFace: (id: number, body: Partial<Pick<StudioFace, "name" | "template" | "css" | "palettes" | "tags" | "font_locked">>) => call<StudioFace>(`staff/faces/${id}`, { method: "PATCH", body, staff: true }),
  dryRun: (id: number, template: string, css: string) => call<{ template: string; css: string; warnings: SanitizeWarning[]; errors: { code: string; message: string }[] }>("staff/faces/sanitize", { method: "POST", body: { face_id: id, template, css }, staff: true }),
  newVersion: (id: number, note: string) => call<StudioFace>(`staff/faces/${id}/versions`, { method: "POST", body: { note }, staff: true }),
  restore: (id: number, n: number) => call<StudioFace>(`staff/faces/${id}/versions/${n}/restore`, { method: "POST", body: {}, staff: true }),
  sendForReview: (id: number) => call<{ preview_url: string; expires_at: string }>(`staff/faces/${id}/send-for-review`, { method: "POST", body: {}, staff: true }),
  newPreview: (id: number) => call<{ preview_url: string; expires_at: string }>(`staff/faces/${id}/previews`, { method: "POST", body: {}, staff: true }),
  revokePreview: (id: number, pid: string) => call<unknown>(`staff/faces/${id}/previews/${pid}/revoke`, { method: "POST", body: {}, staff: true }),
  faceAction: (id: number, a: "publish" | "disable" | "enable") => call<StudioFace>(`staff/faces/${id}/${a}`, { method: "POST", body: {}, staff: true }),
  fileUrl: (id: string, file: string) => `/api/proxy/staff/design-requests/${id}/files/${file}/download`,
};

export async function fetchPublicPreview(token: string): Promise<PreviewPayload | null> {
  const { API_SERVER_URL } = await import("@/lib/config");
  const res = await fetch(`${API_SERVER_URL}/public/custom-previews/${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as PreviewPayload;
}

// ---------------------------------------------------------------- error words, by code
const CODE_KEYS: Record<string, MessageKey> = {
  request_open: tk("designs.err.request_open"), request_finished: tk("designs.err.request_finished"), not_in_review: tk("designs.err.not_in_review"),
  bad_transition: tk("designs.err.bad_transition"), no_face_in_review: tk("designs.err.no_face_in_review"), not_approved: tk("designs.err.not_approved"),
  bad_state: tk("designs.err.bad_state"), face_empty: tk("designs.err.face_empty"), face_palettes: tk("designs.err.face_palettes"),
  last_admin: tk("designs.err.last_admin"), already_enrolled: tk("designs.err.already_enrolled"), totp_not_enrolled: tk("designs.err.totp_not_enrolled"),
  staff_locked: tk("designs.err.staff_locked"), staff_verification_required: tk("designs.err.staff_verification_required"),
  forbidden: tk("designs.err.forbidden"), not_found: tk("designs.err.not_found"), throttled: tk("designs.err.throttled"),
  network_error: tk("designs.err.network"), unauthorized: tk("designs.err.unauthorized"),
};

/** The words for an API error in the page's language, chosen by the error code. A validation error shows its first field message (the
 * server words those in the request's language); anything unknown gets the general sentence. */
export function errorText(e: unknown, t: TFunction): string {
  if (!(e instanceof ApiError)) return t("designs.err.generic");
  const key = CODE_KEYS[e.code];
  if (key) return t(key);
  if (e.code === "validation_error") {
    const field = Object.keys(e.fields)[0];
    return (field ? apiFieldText(e, field, t) : undefined) ?? t("designs.err.validation");
  }
  return t("designs.err.generic");
}

export type { CompanyBrand };
