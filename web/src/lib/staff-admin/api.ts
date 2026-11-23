// The client of the staff dashboard API (/api/v1/staff/...). Every call carries the staff session token.
import { errorFromResponse } from "@/lib/api";
import { call, staffToken } from "@/lib/designs/api";
import type { StaffAuditRow, StaffMe } from "@/lib/designs/api";
import type { StaffRole } from "./roles";

type Q = Record<string, string | undefined>;
const get = <T,>(path: string, query?: Q) => call<T>(path, { staff: true, query });
const send = <T,>(method: string, path: string, body?: unknown) => call<T>(path, { staff: true, method, body: body ?? {} });

/** Download a file the staff API makes (a CSV): the staff token goes in a header, so a plain link would not work. */
export async function downloadFile(path: string, query: Q, filename: string): Promise<void> {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]).toString();
  const res = await fetch(`/api/proxy/${path}${qs ? `?${qs}` : ""}`, { credentials: "same-origin", headers: { "X-Staff-Token": staffToken.get() ?? "" } });
  if (!res.ok) {
    let json: Parameters<typeof errorFromResponse>[1] = null;
    try { json = (await res.json()) as typeof json; } catch { /* not JSON */ }
    throw errorFromResponse(res, json);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface Paged<T> { count: number; page: number; pages: number; page_size: number; results: T[] }

export interface Company {
  id: string; name: string; plan: string | null; plan_code?: string | null; seats_used: number; seats_total: number; status: string; owner_email: string;
  open_design_requests: number; created_at: string; suspended?: boolean;
  /** The country the company chose (ISO code), or "". */
  country?: string;
}
export interface CompanyDetail extends Company {
  suspended: boolean; suspended_at: string | null; suspended_reason: string; deletion_due_at: string | null; country: string; country_guessed: boolean; plan_ends_at: string | null;
  owner: { email: string; full_name: string; last_sign_in: string | null } | null;
  counts: { members: number; cards_published: number; cards_draft: number; cards_suspended: number; leads: number; views_30d: number; open_reports: number; notes: number; support_views: number };
}
export interface Member {
  id: string; email: string; full_name: string; title: string; role: string; status: string; user_id: string | null; department: string;
  joined_at: string | null; invited_at: string | null; last_sign_in: string | null;
}
export interface CardRow {
  id: string; workspace_id: string; workspace_name: string; name: string; title: string; company: string; address: string; status: string; staff_hold: boolean;
  public_code: string; public_url: string; slug: string | null; photo_url: string | null; cover_url: string | null; save_contact: boolean; language: string;
  design: Record<string, unknown>; items: { kind: string; value: string; label: string; on: boolean }[];
  owner: { id: string; full_name: string; email: string } | null; stats: { views: number; scans: number; saves: number; leads: number }; created_at: string;
}
export interface LeadRow {
  id: string; name: string; email: string; phone?: string; company: string; note?: string; status: string; source: string; card_name: string; created_at: string;
  event_name?: string; tag?: string; notes?: { author: string; body: string; created_at: string }[];
}
export interface BrandInfo {
  company_name: string; website: string; design: unknown; lock_design: boolean; show_footer: boolean; logo_url: string | null; symbol_url: string | null;
  background_url: string | null; require_google_signin: boolean; allowed_email_domains: string[]; directory_enabled: boolean; directory_slug: string | null; custom_domain: string | null;
}
export interface ActivityRow { id: string; action: string; label: string; actor_email: string; actor_name: string; target_label: string; details: Record<string, unknown>; created_at: string }
export interface Note { id: string; author_email: string; body: string; created_at: string }

export interface Overview {
  health: { api_up: boolean; db_ok: boolean; db_ms: number; p95_ms: number | null; requests_10m: number; errors_last_hour: number };
  jobs: { name: string; label: string; state: string }[];
  email: { sent: number; failed: number; resent: number };
  numbers: { companies: number; active_cards: number; views_today: number; new_companies_week: number; open_reports: number; open_data_requests: number; open_support_tickets: number | null };
  growth: { week: string; n: number }[];
  attention: { kind: string; level: "bad" | "warn" | "info"; count: number; text: string; path: string }[];
  recent_activity: StaffAuditRow[];
}

export interface SearchResult {
  companies: Company[];
  people: { id: string; email: string; full_name: string; staff_role: string; is_active: boolean; companies: { id: string; name: string; role: string }[] }[];
  cards: CardRow[];
}
export interface CardDrawer {
  card: CardRow; company: Company; reports: { id: string; reason: string; status: string; created_at: string }[];
  history: { at: string; text: string; who: string; kind: string; details?: Record<string, unknown> }[];
}
export interface UserDetail {
  id: string; email: string; full_name: string; language: string | null; created_at: string; email_verified: boolean; is_active: boolean; staff_role: string; product_updates: boolean;
  sign_in_methods: { password: boolean; google: boolean }; last_sign_in: string | null; deletion_due_at: string | null;
  sessions: { id: string; started_at: string; expires_at: string }[];
  memberships: { company_id: string; company: string; kind: string; role: string; status: string }[];
}

export interface SupportSession {
  id: string; company_id: string; company_name: string; staff_email: string; reason: string; started_at: string; expires_at: string; ended_at: string | null;
  ended_how: string; active: boolean; seconds_left: number; pages: { t: string; page: string }[];
}

export interface Report {
  id: string; card_id: string | null; card_name: string; company_id: string | null; company_name: string; reason: string; reason_label: string; note: string; reporter_email: string;
  status: "new" | "reviewing" | "actioned" | "dismissed"; assignee: string | null; created_at: string; due_at: string; resolved_at: string | null; outcome: string;
  sla: { state: "late" | "soon" | "ok" | "done"; minutes_left: number | null };
}
export interface ReportDetail extends Report { history: { t: string; who: string; kind: string; text: string }[]; card: CardRow | null; related: Report[] }
export interface ReportList extends Paged<Report> { counts: Record<string, number>; late: number }

export interface DataRequest {
  id: string; kind: "export" | "delete"; scope: "user" | "workspace"; status: string; requested_at: string; due_at: string; days_left: number; overdue: boolean; user_email: string;
  user_id: string | null; company_id: string | null; company_name: string; scheduled_for: string | null; completed_at: string | null; error: string; handled_by: string | null;
  owns_company_with_people: boolean; note: string;
}

export interface Application {
  id: string; company: string; name: string; email: string; size: string; message: string; source: string; language: string; status: string; assignee: string | null;
  notes: { t: string; who: string; text: string }[]; created_at: string; updated_at: string;
}
export interface Announcement {
  id: string; title_en: string; title_ar: string; body_en: string; body_ar: string; severity: "info" | "warning" | "critical"; audience_kind: string; audience_values: string[];
  audience: string; banner: boolean; starts_at: string; ends_at: string | null; send_email: boolean; email_kind: string; email_send_at: string | null; email_status: string;
  email_sent_count: number; cancelled: boolean; live: boolean; created_at: string;
}
export interface AnnouncementInput {
  title_en: string; title_ar: string; body_en: string; body_ar: string; severity: string; audience_kind: string; audience_values: string[]; banner: boolean;
  send_email: boolean; email_kind: string; starts_at?: string; ends_at?: string; email_send_at?: string;
}

export interface AnalyticsData {
  weeks: { week: string; new_companies: number; new_cards: number; views: number; scans: number; saves: number; leads: number }[];
  countries: { country: string; views: number }[]; company_countries: { country: string; companies: number; guessed: number }[]; sizes: { label: string; companies: number }[]; top_companies: { id: string; name: string; views: number }[];
  retention: { week: string; companies: number; after: Record<string, number | null> }[];
}

export interface HealthData {
  health: Overview["health"]; series: { hour: string; requests: number; errors: number; p95_ms: number | null }[];
  storage: { media_bytes: number; private_bytes: number; database_bytes: number | null };
}
export interface JobRow { name: string; label: string; every: string; state: "ok" | "late" | "failed" | "unknown"; last_ok_at: string | null; duration_s: number | null; note: string }
export interface EmailRow { id: string; to: string; subject: string; kind: string; status: string; error: string; created_at: string; can_resend: boolean }
export interface EmailData extends Paged<EmailRow> { last_24h: { sent: number; failed: number; resent: number }; days: { day: string; sent: number; failed: number }[] }
export interface ErrorRow { id: number; at: string; source: string; path: string; status: string; message: string; trace_hash: string }
export interface ErrorsData extends Paged<ErrorRow> { groups: { trace_hash: string; message: string; path: string; n: number }[] }

export interface Flag {
  key: string; description: string; known: boolean; state: "off" | "selected" | "everyone"; rollout_percent: number;
  companies: { id: string; name: string }[]; history: { at: string; who: string; text: string }[];
}
export interface BillingData {
  payments_parked: boolean;
  plans: { code: string; name: string; kind: string; interval: string; price_minor: number; currency: string; per_seat: boolean; max_cards: number; min_seats: number; active: boolean; companies: number }[];
  invoices: unknown[]; grants: { company_id: string; company: string; plan: string; seats: number; until: string; at: string }[];
}

export interface StaffPerson {
  id: string; email: string; full_name: string; staff_role: StaffRole; totp_enrolled: boolean; is_active: boolean; last_sign_in: string | null; recovery_codes_left: number;
  sessions: { id: string; method: string; started_at: string; expires_at: string; last_seen_at: string | null; new_address_seen: boolean }[];
}
export interface PermissionMatrix {
  roles: { key: StaffRole; summary: string }[]; permissions: { key: string; label: string; group: string; roles: StaffRole[] }[];
}
export interface AuditPage extends Paged<StaffAuditRow> { actions: { key: string; label: string }[]; categories: { key: string; label: string }[] }

export const sa = {
  me: () => get<StaffMe>("staff/me"),
  overview: () => get<Overview>("staff/overview"),
  // companies
  companies: (q: Q) => get<Paged<Company> & { plans: { code: string; name: string }[] }>("staff/companies", q),
  company: (id: string) => get<CompanyDetail>(`staff/companies/${id}`),
  companyTab: <T,>(id: string, tab: string, q?: Q) => get<T>(`staff/companies/${id}/${tab}`, q),
  addNote: (id: string, body: string) => send<Note>("POST", `staff/companies/${id}/notes`, { body }),
  suspendCompany: (id: string, reason: string) => send<CompanyDetail>("POST", `staff/companies/${id}/suspend`, { reason }),
  restoreCompany: (id: string, reason: string) => send<CompanyDetail>("POST", `staff/companies/${id}/restore`, { reason }),
  bulkCompanies: (ids: string[], action: "suspend" | "restore", reason: string) => send<{ results: { id: string; ok: boolean; error?: string }[] }>("POST", "staff/companies/bulk", { ids, action, reason }),
  // people and cards
  search: (q: string) => get<SearchResult>("staff/search", { q }),
  card: (id: string) => get<CardDrawer>(`staff/cards/${id}`),
  suspendCard: (id: string, reason: string) => send<CardRow>("POST", `staff/cards/${id}/suspend`, { reason }),
  restoreCard: (id: string, reason: string) => send<CardRow>("POST", `staff/cards/${id}/restore`, { reason }),
  user: (id: string) => get<UserDetail>(`staff/users/${id}`),
  signOutUser: (id: string) => send<{ revoked: number }>("POST", `staff/users/${id}/sign-out`),
  // support view
  supportCurrent: () => get<{ session: SupportSession | null }>("staff/support-view"),
  supportStart: (company_id: string, reason: string) => send<SupportSession>("POST", "staff/support-view", { company_id, reason }),
  supportEnd: (id: string) => send<SupportSession>("POST", `staff/support-view/${id}/end`),
  supportHistory: () => get<SupportSession[]>("staff/support-view/history"),
  supportPage: <T,>(id: string, page: string) => get<{ session: SupportSession; data: T }>(`staff/support-view/${id}/${page}`),
  // abuse and data requests
  reports: (q: Q) => get<ReportList>("staff/abuse", q),
  report: (id: string) => get<ReportDetail>(`staff/abuse/${id}`),
  reportAction: (id: string, action: string, note?: string) => send<Report>("POST", `staff/abuse/${id}/action`, { action, note }),
  reportsBulk: (ids: string[], action: string) => send<{ results: { id: string; ok: boolean }[] }>("POST", "staff/abuse/bulk", { ids, action }),
  dataRequests: (q: Q) => get<Paged<DataRequest> & { overdue: number }>("staff/data-requests", q),
  dataAction: (id: string, body: { action: string; typed?: string; ack_company?: boolean; note?: string }) => send<DataRequest>("POST", `staff/data-requests/${id}/action`, body),
  // growth
  applications: (q: Q) => get<Paged<Application> & { counts: Record<string, number>; design_requests_open: number }>("staff/applications", q),
  updateApplication: (id: string, body: { status?: string; assignee?: string | null; note?: string }) => send<Application>("PATCH", `staff/applications/${id}`, body),
  announcements: () => get<{ results: Announcement[]; plans: { code: string; name: string }[] }>("staff/announcements"),
  announcementPreview: (b: { audience_kind: string; audience_values: string[]; email_kind: string }) => send<{ companies: number; people: number; label: string; sample: string[] }>("POST", "staff/announcements/preview", b),
  createAnnouncement: (b: AnnouncementInput) => send<Announcement>("POST", "staff/announcements", b),
  cancelAnnouncement: (id: string) => send<Announcement>("POST", `staff/announcements/${id}/cancel`),
  analytics: (weeks: number) => get<AnalyticsData>("staff/analytics", { weeks: String(weeks) }),
  downloadAnalytics: (weeks: number) => downloadFile("staff/analytics/export", { weeks: String(weeks) }, "analytics.csv"),
  // platform
  systemHealth: () => get<HealthData>("staff/system/health"),
  systemJobs: () => get<{ jobs: JobRow[]; state_dir_found: boolean }>("staff/system/jobs"),
  systemEmail: (q: Q) => get<EmailData>("staff/system/email", q),
  resendEmail: (id: string) => send<EmailRow>("POST", `staff/system/email/${id}/resend`),
  systemErrors: (q: Q) => get<ErrorsData>("staff/system/errors", q),
  flags: () => get<{ flags: Flag[]; history: { at: string; who: string; text: string }[] }>("staff/flags"),
  setFlag: (key: string, body: { state?: string; rollout_percent?: number; company_ids?: string[] }) => send<Flag>("PATCH", `staff/flags/${key}`, body),
  billing: () => get<BillingData>("staff/billing"),
  grantPlan: (b: { company_id: string; plan_code?: string; seats?: number; reason: string }) => send<{ company: string; plan: string; seats: number; until: string }>("POST", "staff/billing/grant", b),
  // staff
  permissions: () => get<PermissionMatrix>("staff/permissions"),
  team: () => get<{ people: StaffPerson[]; session_hours: number }>("staff/team"),
  invite: (email: string, role: string) => send<{ granted: boolean; invited: boolean }>("POST", "staff/team", { email, role }),
  setRole: (id: string, role: string) => send<StaffPerson>("PATCH", `staff/members/${id}`, { role }),
  removeStaff: (id: string) => send<void>("DELETE", `staff/members/${id}`),
  resetTotp: (id: string) => send<StaffPerson>("POST", `staff/members/${id}/reset-totp`),
  revokeSessions: (id: string) => send<{ revoked: number }>("POST", `staff/members/${id}/sessions/revoke`),
  audit: (q: Q) => get<AuditPage>("staff/audit", q),
  downloadAudit: (q: Q) => downloadFile("staff/audit/export", q, "staff-audit-log.csv"),
};
