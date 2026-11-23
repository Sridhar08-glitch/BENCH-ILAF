// Shapes of the lead workflow, webhook, analytics breakdown and weekly report endpoints (see API_CONTRACT.md).
import type { Lead } from "../types";

export interface Person {
  id: string;
  name: string;
  email: string;
  role?: string;
}

export interface LeadNote {
  id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface LeadActivity {
  id: string;
  kind: "created" | "assigned" | "status_changed" | "note_added" | "emailed";
  actor: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface LeadDetail extends Lead {
  notes: LeadNote[];
  activity: LeadActivity[];
}

export interface LeadQuery {
  q?: string;
  status?: string;
  source?: string;
  /** A member id, "me" or "none". */
  assignee?: string;
  card_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface LeadBulkResult {
  action: "assign" | "status";
  total: number;
  ok: number;
  failed: number;
  results: { id: string; name: string; ok: boolean; reason: string | null; code: string | null }[];
}

// ---- webhooks
export type WebhookEvent = "lead.created" | "lead.updated" | "lead.assigned";

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  secret_hint: string;
  /** Only in the answer that creates the webhook or makes a new secret. */
  secret?: string;
  consecutive_failures: number;
  disabled_reason: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
}

export interface Delivery {
  id: string;
  event_id: string;
  event_type: string;
  status: "pending" | "success" | "failed";
  attempts: number;
  response_status: number | null;
  error: string;
  duration_ms: number | null;
  is_test: boolean;
  next_attempt_at: string | null;
  created_at: string;
  delivered_at: string | null;
  response_body?: string;
  payload?: unknown;
}

// ---- analytics
export interface Metrics {
  views: number;
  scans: number;
  taps: number;
  saves: number;
  link_clicks: number;
  leads: number;
  won: number;
}

export interface Period {
  from: string;
  to: string;
  days: number;
  prev_from: string;
  tz: string;
  group?: "day" | "week" | "month";
}

export interface PersonRow {
  key: string;
  member_id: string | null;
  name: string;
  person: string;
  department_id: string | null;
  department: string | null;
  cards: number;
  card_ids: string[];
  totals: Metrics;
  prev: Metrics;
}

export interface PeopleResult {
  period: Period;
  by: "person" | "card";
  rows: PersonRow[];
  totals: Metrics;
  prev_totals: Metrics;
}

export interface DepartmentRow {
  id: string | null;
  name: string;
  people: number;
  cards: number;
  totals: Metrics;
  prev: Metrics;
  top_person: { name: string; views: number } | null;
}

export interface DepartmentsResult {
  period: Period;
  rows: DepartmentRow[];
  totals: Metrics;
  prev_totals: Metrics;
}

export interface LinkRow {
  kind: string;
  clicks: number;
  prev_clicks: number;
  visitors: number;
  share: number;
  top_card: { name: string; clicks: number } | null;
}

export interface LinksResult {
  period: Period;
  rows: LinkRow[];
  total: number;
  prev_total: number;
}

export type SourceKey = "nfc" | "qr" | "link" | "email" | "other";

export interface SourceRow {
  key: SourceKey;
  views: number;
  prev_views: number;
  saves: number;
  leads: number;
  share: number;
}

export interface SourcesResult {
  period: Period;
  rows: SourceRow[];
  total: number;
  series: ({ date: string; views: number; saves: number; link_clicks: number; leads: number } & Record<SourceKey, number>)[];
}

export interface AnalyticsQuery {
  days?: number;
  from?: string;
  to?: string;
  group?: "day" | "week" | "month";
  tz?: string;
  card_id?: string;
  by?: "person" | "card";
}

// ---- weekly report
export interface ReportPrefs {
  personal_report: boolean;
  company_report: boolean | null;
  can_company_report: boolean;
}

export interface ReportPreview {
  kind: "personal" | "company";
  week: { year: number; week: number; from: string; to: string; partial: boolean };
  subject: string;
  html: string;
  text: string;
}
