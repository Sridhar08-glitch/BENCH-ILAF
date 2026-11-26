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
  /** Number of cards (only on the companies list). */
  cards?: number;
  /** Plan facts of the companies list. auto_renew: auto (Stripe charges again), manual (off), cancels (switched off, runs to its end), none (no paid plan). */
  auto_renew?: "auto" | "manual" | "cancels" | "none"; payment_failed?: boolean; enterprise?: boolean; grandfathered?: boolean; grandfathered_until?: string | null;
  plan_ends_at?: string | null; domain_status?: string | null;
}
export interface CompanyDetail extends Company {
  suspended: boolean; suspended_at: string | null; suspended_reason: string; deletion_due_at: string | null; country: string; country_guessed: boolean; plan_ends_at: string | null;
  owner: { email: string; full_name: string; last_sign_in: string | null } | null;
  /** Where the company is found on the web (its own domain or its directory page), or "". */
  public_address: string;
  /** Card views per day for the last 14 days, oldest first. */
  views_14d: { day: string; views: number }[];
  counts: { members: number; cards_published: number; cards_draft: number; cards_suspended: number; leads: number; views_30d: number; open_reports: number; notes: number; support_views: number };
}
export interface Member {
  id: string; email: string; full_name: string; title: string; role: string; status: string; user_id: string | null; department: string;
  joined_at: string | null; invited_at: string | null; last_sign_in: string | null;
  /** The state of the person's cards: published, suspended, draft or none. */
  card_status: "published" | "suspended" | "draft" | "none"; cards: number;
  /** An employee's own switch "share my new contacts with the company" (null for owners and admins). The setting only, never a contact. */
  share_contacts?: boolean | null; share_contacts_changed_at?: string | null;
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
  /** The company's domain claim (pending, verified, failed, expired, dns_broken) without the DNS token. */
  custom_domain_info?: { domain: string; status: string; serving: boolean; last_checked_at: string | null; last_error: string | null } | null;
  colours?: { primary: string; accent: string; mode: string; text?: string } | null; palette?: Record<string, string> | null; font?: string;
  logo_display?: string; logo_placement?: string; logo_corner?: string; logo_chip?: string; show_company_name?: boolean;
  /** Percent of the automatic size, and the places the owner gave the logo on some designs (f12 = card face 12, t3 = page style 3). */
  logo_size?: number; logo_free?: Record<string, { x: number; y: number; w: number }>; artwork_mode?: string; template_front_url?: string | null;
  /** What employees may add under their cards, and the rights they have on their own. */
  extras?: { mode: string; kinds: string[] }; rights?: Record<string, string>;
  /** The public code of the company's own card, when it has one. */
  company_card?: string | null;
}
export interface ActivityRow { id: string; action: string; label: string; actor_email: string; actor_name: string; target_label: string; details: Record<string, unknown>; created_at: string }
export interface Note { id: string; author_email: string; body: string; created_at: string }

export interface Overview {
  health: {
    api_up: boolean; db_ok: boolean; db_ms: number; p95_ms: number | null; requests_10m: number; errors_last_hour: number;
    p50_ms: number | null; requests_1h: number; error_rate_1h: number | null; success_rate_7d: number | null; requests_7d: number;
  };
  jobs: { name: string; label: string; state: string }[];
  email: { sent: number; failed: number; resent: number };
  /** Conversion funnel (7 and 30 days), revenue per month in QAR, renewals due and failed payments. */
  money: MoneyBlock;
  numbers: {
    companies: number; active_cards: number; views_today: number; new_companies_week: number; open_reports: number; open_data_requests: number; open_support_tickets: number | null;
    deltas: { companies_4w: number; active_cards_4w: number; views_yesterday: number; new_companies_prev_week: number; reports_late: number; data_due_soon: number };
  };
  growth: { week: string; n: number }[];
  growth_total: { week: string; n: number }[];
  customer_events: { kind: "signup" | "card" | "upgrade" | "support"; at: string; text: string; path: string }[];
  attention: { kind: string; level: "bad" | "warn" | "info"; count: number; text: string; path: string }[];
  recent_activity: StaffAuditRow[];
}

export interface SearchResult {
  companies: Company[];
  people: { id: string; email: string; full_name: string; staff_role: string; is_active: boolean; companies: { id: string; name: string; role: string }[] }[];
  cards: CardRow[];
}
export interface PlanCell { plan: string | null; plan_code: string | null; state: "live" | "expired" | "none" }
export interface PersonRow {
  id: string; email: string; full_name: string; email_verified: boolean; created_at: string; last_sign_in: string | null; staff_role: string; is_active: boolean;
  status: "active" | "disabled" | "deletion_pending"; deletion_due_at: string | null; two_step: boolean; country: string;
  personal: PlanCell; cards: number; cards_published: number; company_count: number;
  companies: (PlanCell & { id: string; name: string; role: string; suspended: boolean })[];
}
export interface PeoplePage { count: number; offset: number; limit: number; results: PersonRow[]; plans: { code: string; name: string; kind: string }[] }
/** One row of the card list: the card plus how many open abuse reports it has. */
export interface CardListRow extends CardRow { open_reports: number }
export interface CardStatusCounts { all: number; active: number; reported: number; suspended: number; draft: number }
export interface CardsPage { count: number; offset: number; limit: number; status_counts: CardStatusCounts; results: CardListRow[] }
export interface CardDrawer {
  card: CardRow; details: { holder_email: string; card_email: string; created_at: string }; company: Company; reports: { id: string; reason: string; status: string; created_at: string }[];
  history: { at: string; text: string; who: string; kind: string; details?: Record<string, unknown> }[];
}
export interface UserDetail {
  id: string; email: string; full_name: string; language: string | null; created_at: string; email_verified: boolean; is_active: boolean; staff_role: string; product_updates: boolean;
  sign_in_methods: { password: boolean; google: boolean }; last_sign_in: string | null; deletion_due_at: string | null;
  sessions: { id: string; started_at: string; expires_at: string }[];
  /** The person's own workspace: the free week (running or ended) or the paid plan. */
  personal: {
    workspace_id: string | null; state: "none" | "free_week" | "free_week_ended" | "paid" | "paid_ended"; plan_code: string | null; plan: string | null;
    starts_at: string | null; ends_at: string | null; auto_renew: "auto" | "manual" | "cancels" | "none"; payment_failed: boolean;
  };
  memberships: { company_id: string; company: string; kind: string; role: string; status: string; share_contacts: boolean | null; share_contacts_changed_at: string | null }[];
}

export interface SupportSession {
  id: string; company_id: string; company_name: string; staff_email: string; reason: string; started_at: string; expires_at: string; ended_at: string | null;
  ended_how: string; active: boolean; seconds_left: number; pages: { t: string; page: string }[];
}

export interface Report {
  id: string; number: number | null; short_id: string; card_id: string | null; card_name: string; company_id: string | null; company_name: string; reason: string; reason_label: string; note: string; reporter_email: string;
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
  assignee_id: string | null; assignee_name: string | null; country: string;
}
export interface Assignee { id: string; email: string; full_name: string; staff_role: string }
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
  totals: { companies: number; active_cards: number; views_30d: number; leads_30d: number };
  active_cards: { week: string; n: number }[];
  retention_monthly: { month: string; companies: number; after: Record<string, number | null> }[];
  money: MoneyBlock;
}

export interface QueueRow { key: string; label: string; waiting: number; failing: number; state: "ok" | "warn" | "bad" }
export interface HealthData {
  health: Overview["health"]; series: { hour: string; requests: number; errors: number; p95_ms: number | null; p50_ms: number | null; error_rate: number | null }[];
  storage: { media_bytes: number; private_bytes: number; database_bytes: number | null; categories: { key: string; label: string; bytes: number }[] };
  queues: QueueRow[];
}
export interface JobRow { name: string; label: string; every: string; state: "ok" | "late" | "failed" | "unknown"; last_ok_at: string | null; duration_s: number | null; note: string }
export interface EmailRow { id: string; to: string; subject: string; kind: string; status: string; error: string; created_at: string; can_resend: boolean }
export interface EmailData extends Paged<EmailRow> {
  last_24h: { sent: number; failed: number; resent: number }; days: { day: string; sent: number; failed: number }[];
  bounce: { connected: boolean; bounced: number | null; rate: number | null }; resendable: number;
}
export interface ErrorRow { id: number; at: string; source: string; path: string; status: string; message: string; trace_hash: string }
export interface ErrorsData extends Paged<ErrorRow> { groups: { trace_hash: string; message: string; path: string; n: number }[] }

export interface Flag {
  key: string; description: string; known: boolean; state: "off" | "selected" | "everyone"; rollout_percent: number;
  companies: { id: string; name: string }[]; history: { at: string; who: string; text: string; reason?: string }[];
}
export interface BillingPlan {
  code: string; name: string; kind: string; interval: string; price_minor: number; currency: string; per_seat: boolean; max_cards: number; min_seats: number;
  active: boolean; purchasable: boolean; by_quote: boolean; companies: number;
}
export interface BillingSummary {
  currency: string;
  active_by_plan: { plan_code: string; plan: string; subscriptions: number; seats: number; arr_minor: number }[];
  active_total: number;
  /** Estimated yearly recurring revenue: price x seats of every live paid subscription (Enterprise: its last real payment). */
  arr_minor: number; arr_is_estimate: boolean;
  free_weeks: { running: number; ending_soon: number; ended_unpaid: number; converted: number };
  renewals: { in_7_days: { auto: number; manual: number }; in_30_days: { auto: number; manual: number }; in_grace: number };
  failed_payments: number;
  enterprise_requests: { requested: number; quoted: number };
}
export interface BillingData {
  summary: BillingSummary; plans: BillingPlan[];
  grants: { company_id: string; company: string; kind: string; plan: string; seats: number; until: string; at: string }[];
}
export interface BillingWho { workspace_id: string; company: string; kind: "company" | "personal" }
export interface RenewalRow extends BillingWho {
  plan_code: string; plan: string; seats: number; ends_at: string; days_left: number; renewal: "auto" | "manual" | "cancels" | "none"; payment_failed: boolean; owner_email: string;
}
export interface FailedPaymentRow extends BillingWho {
  plan_code: string; plan: string; seats: number; owner_email: string; failed_at: string; invoice_id: string; ends_at: string; grace_ends_at: string; live: boolean;
}
export interface FreeWeekRow { workspace_id: string; owner_email: string; started_at: string; ends_at: string; state: "running" | "ending_soon" | "ended"; published: boolean }
export interface PaymentRow {
  id: string; number: string; company_id: string; company: string; kind: "company" | "personal"; plan_code: string; plan: string; seats: number; amount_minor: number;
  currency: string; source: "stripe" | "dev" | "manual"; paid_at: string; period_end: string; stripe_invoice_id: string;
}
export interface FunnelStep { days: number; signed_up: number; created_card: number; published: number; still_live: number; ended_unpaid: number; converted: number }
/** The money block of the overview and the analytics: funnel, revenue per month (QAR) and the renewal and failure counts. */
export interface MoneyBlock {
  funnel: { "7": FunnelStep; "30": FunnelStep }; revenue_monthly: { month: string; amount_minor: number; payments: number }[]; currency: string;
  renewals_due_7: number; renewals_due_30: number; failed_payments: number; enterprise_requests_waiting: number;
}
export interface CompanyBilling {
  subscription: {
    status: string; plan_code: string | null; plan: string | null; interval?: string; seats_total: number; seats_used: number; starts_at: string | null; ends_at: string | null;
    grace_ends_at: string | null; live: boolean; auto_renew: boolean; cancel_at_period_end: boolean; renews_at: string | null; payment_failed: boolean;
    payment_failed_at: string | null; failed_invoice_id: string; stripe_customer_id: string; stripe_subscription_id: string;
  };
  enterprise: { features_on: boolean; grandfathered: boolean; grandfathered_until: string | null; latest_request: EnterpriseRequestRow | null };
  /** How many employees switched on "share my new contacts with the company". Counts only. */
  sharing: { employees: number; sharing: number; last_changed_at: string | null; contacts_shared: number };
  domain: {
    domain: string; status: string; serving: boolean; holding: boolean; requested_at: string | null; verified_at: string | null; last_checked_at: string | null;
    last_error: string | null; last_error_message: string | null; expires_at: string | null; grace_ends_at: string | null; failing_since: string | null; broken_at: string | null;
  } | null;
  payments: PaymentRow[];
}

export interface EnterpriseRequestRow {
  id: string; status: "requested" | "quoted" | "accepted" | "declined" | "cancelled"; company_id: string; company: string;
  requested_by: { full_name: string; email: string } | null; seats_wanted: number; seats_used: number; message: string; phone: string;
  quoted_seats: number | null; quoted_price_per_seat_minor: number | null; quoted_total_minor: number | null; currency: string; staff_note: string;
  quoted_by: string; created_at: string; quoted_at: string | null; decided_at: string | null;
}
export interface EnterpriseRequestsData extends Paged<EnterpriseRequestRow> { counts: Record<string, number> }

export interface StaffPerson {
  id: string; email: string; full_name: string; staff_role: StaffRole; totp_enrolled: boolean; is_active: boolean; last_sign_in: string | null; recovery_codes_left: number;
  sessions: { id: string; method: string; started_at: string; expires_at: string; last_seen_at: string | null; new_address_seen: boolean; device?: string; country?: string }[];
}
/** One staff session of the Security tab. `email` and `user_id` are set on the other people's sessions an admin sees. */
export interface SecuritySession {
  id: string; device: string; country: string; method: string; started_at: string; expires_at: string; last_seen_at: string | null; new_address_seen: boolean;
  current: boolean; user_id?: string; email?: string; full_name?: string;
}
export interface SecurityData {
  mine: SecuritySession[];
  everyone: { two_step: { id: string; email: string; full_name: string; staff_role: StaffRole; enrolled: boolean }[]; sessions: SecuritySession[] } | null;
}
export interface AnnouncementLists { results: Announcement[]; plans: { code: string; name: string }[]; countries: { code: string; companies: number }[] }
export interface PermissionMatrix {
  roles: { key: StaffRole; summary: string }[]; permissions: { key: string; label: string; group: string; roles: StaffRole[] }[];
}
/** One audit entry as the audit log shows it: with its category and who did it ("System" when nobody did). */
export interface AuditEntry extends StaffAuditRow { category: string; category_label: string; actor_name: string; from: string }
export interface AuditPage extends Paged<AuditEntry> { actions: { key: string; label: string }[]; categories: { key: string; label: string }[] }

export const sa = {
  me: () => get<StaffMe>("staff/me"),
  overview: () => get<Overview>("staff/overview"),
  // companies
  companies: (q: Q) => get<Paged<Company> & { plans: { code: string; name: string }[] }>("staff/companies", q),
  company: (id: string) => get<CompanyDetail>(`staff/companies/${id}`),
  companyTab: <T,>(id: string, tab: string, q?: Q) => get<T>(`staff/companies/${id}/${tab}`, q),
  addNote: (id: string, body: string) => send<Note>("POST", `staff/companies/${id}/notes`, { body }),
  suspendCompany: (id: string, reason: string, confirmName?: string) => send<CompanyDetail>("POST", `staff/companies/${id}/suspend`, { reason, confirm_name: confirmName }),
  restoreCompany: (id: string, reason: string) => send<CompanyDetail>("POST", `staff/companies/${id}/restore`, { reason }),
  downloadCompanies: (q: Q) => downloadFile("staff/companies/export", q, "companies.csv"),
  bulkCompanies: (ids: string[], action: "suspend" | "restore", reason: string) => send<{ results: { id: string; ok: boolean; error?: string }[] }>("POST", "staff/companies/bulk", { ids, action, reason }),
  // people and cards
  search: (q: string) => get<SearchResult>("staff/search", { q }),
  people: (q: Q) => get<PeoplePage>("staff/people", q),
  cards: (q: Q) => get<CardsPage>("staff/cards", q),
  card: (id: string) => get<CardDrawer>(`staff/cards/${id}`),
  /** Writes "looked at the public page" to the audit log. */
  lookPublicPage: (id: string) => send<{ ok: boolean }>("POST", `staff/cards/${id}/look`, { what: "public_page" }),
  suspendCard: (id: string, reason: string) => send<CardRow>("POST", `staff/cards/${id}/suspend`, { reason }),
  restoreCard: (id: string, reason: string) => send<CardRow>("POST", `staff/cards/${id}/restore`, { reason }),
  user: (id: string) => get<UserDetail>(`staff/users/${id}`),
  signOutUser: (id: string, reason?: string) => send<{ revoked: number }>("POST", `staff/users/${id}/sign-out`, { reason }),
  // support view
  supportCurrent: () => get<{ session: SupportSession | null }>("staff/support-view"),
  supportStart: (company_id: string, reason: string) => send<SupportSession>("POST", "staff/support-view", { company_id, reason }),
  supportEnd: (id: string) => send<SupportSession>("POST", `staff/support-view/${id}/end`),
  supportHistory: () => get<SupportSession[]>("staff/support-view/history"),
  supportPage: <T,>(id: string, page: string) => get<{ session: SupportSession; data: T }>(`staff/support-view/${id}/${page}`),
  // abuse and data requests
  reports: (q: Q) => get<ReportList>("staff/abuse", q),
  report: (id: string) => get<ReportDetail>(`staff/abuse/${id}`),
  reportAction: (id: string, action: string, note?: string, confirm_name?: string) => send<Report>("POST", `staff/abuse/${id}/action`, { action, note, ...(confirm_name ? { confirm_name } : {}) }),
  reportsBulk: (ids: string[], action: string, note?: string) => send<{ results: { id: string; ok: boolean; error?: string }[] }>("POST", "staff/abuse/bulk", { ids, action, ...(note ? { note } : {}) }),
  dataRequests: (q: Q) => get<Paged<DataRequest> & { overdue: number }>("staff/data-requests", q),
  dataAction: (id: string, body: { action: string; typed?: string; ack_company?: boolean; note?: string; reason?: string }) => send<DataRequest>("POST", `staff/data-requests/${id}/action`, body),
  // growth
  applications: (q: Q) => get<Paged<Application> & { counts: Record<string, number>; design_requests_open: number; assignees: Assignee[] }>("staff/applications", q),
  updateApplication: (id: string, body: { status?: string; assignee?: string | null; note?: string }) => send<Application>("PATCH", `staff/applications/${id}`, body),
  announcements: () => get<AnnouncementLists>("staff/announcements"),
  announcementAudience: (kind: string, values: string[], emailKind: string) => get<{ companies: number; people: number; label: string }>("staff/announcements/audience", { kind, values: values.join(","), email_kind: emailKind }),
  announcementEmailPreview: (q: { title: string; body: string; lang: string; email_kind: string }) => get<{ subject: string; html: string; text: string; lang: string }>("staff/announcements/email-preview", q),
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
  resendAllEmails: () => send<{ tried: number; sent: number; failed: number }>("POST", "staff/system/email/resend-all"),
  systemErrors: (q: Q) => get<ErrorsData>("staff/system/errors", q),
  flags: () => get<{ flags: Flag[]; history: { at: string; who: string; text: string; reason?: string }[] }>("staff/flags"),
  setFlag: (key: string, body: { state?: string; rollout_percent?: number; company_ids?: string[]; reason?: string }) => send<Flag>("PATCH", `staff/flags/${key}`, body),
  billing: () => get<BillingData>("staff/billing"),
  billingRenewals: (q: Q) => get<Paged<RenewalRow>>("staff/billing/renewals", q),
  billingFailed: (q: Q) => get<Paged<FailedPaymentRow>>("staff/billing/failed-payments", q),
  billingFreeWeeks: (q: Q) => get<Paged<FreeWeekRow>>("staff/billing/free-weeks", q),
  billingPayments: (q: Q) => get<Paged<PaymentRow>>("staff/billing/payments", q),
  downloadPayments: (q: Q) => downloadFile("staff/billing/payments/export", q, "payments.csv"),
  companyBilling: (id: string) => get<CompanyBilling>(`staff/companies/${id}/billing`),
  grantPlan: (b: { company_id: string; plan_code?: string; seats?: number; reason: string }) => send<{ company: string; plan: string; seats: number; until: string }>("POST", "staff/billing/grant", b),
  enterpriseRequests: (q: Q) => get<EnterpriseRequestsData>("staff/enterprise-requests", q),
  quoteEnterprise: (id: string, b: { seats: number; price_per_seat_minor: number; note?: string }) => send<EnterpriseRequestRow>("POST", `staff/enterprise-requests/${id}/quote`, b),
  declineEnterprise: (id: string, b: { note?: string }) => send<EnterpriseRequestRow>("POST", `staff/enterprise-requests/${id}/decline`, b),
  // staff
  permissions: () => get<PermissionMatrix>("staff/permissions"),
  team: () => get<{ people: StaffPerson[]; session_hours: number }>("staff/team"),
  invite: (email: string, role: string, reason?: string) => send<{ granted: boolean; invited: boolean }>("POST", "staff/team", { email, role, reason }),
  setRole: (id: string, role: string, reason?: string) => send<StaffPerson>("PATCH", `staff/members/${id}`, { role, reason }),
  removeStaff: (id: string, reason?: string) => send<void>("DELETE", `staff/members/${id}`, { reason }),
  resetTotp: (id: string, reason?: string) => send<StaffPerson>("POST", `staff/members/${id}/reset-totp`, { reason }),
  revokeSessions: (id: string, reason?: string) => send<{ revoked: number }>("POST", `staff/members/${id}/sessions/revoke`, { reason }),
  // frame and security
  counts: () => get<{ open_reports: number; open_data_requests: number }>("staff/counts"),
  security: () => get<SecurityData>("staff/security"),
  revokeSession: (id: string, reason?: string) => send<{ revoked: number }>("POST", `staff/security/sessions/${id}/revoke`, { reason }),
  audit: (q: Q) => get<AuditPage>("staff/audit", q),
  downloadAudit: (q: Q) => downloadFile("staff/audit/export", q, "staff-audit-log.csv"),
};
