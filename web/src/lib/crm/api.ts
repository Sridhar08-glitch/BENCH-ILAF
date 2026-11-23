// API calls for lead assignment and notes, webhooks, analytics breakdowns and the weekly report.
import { ApiError, errorFromResponse, waitingError } from "../api";
import { runtimeT } from "../i18n";
import type { LeadStatus } from "../types";
import type {
  AnalyticsQuery, DepartmentsResult, Delivery, LeadBulkResult, LeadDetail, LeadNote, LeadQuery, LinksResult, PeopleResult, Person,
  ReportPrefs, ReportPreview, SourcesResult, Webhook, WebhookEvent,
} from "./types";
import type { Analytics, Lead } from "../types";

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(q?: Query): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, query?: Query): Promise<T> {
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
    res = await fetch(`/api/proxy/${path}${qs(query)}`, init);
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

export const crm = {
  // leads
  leads: (ws: string, q: LeadQuery) => call<{ count: number; results: Lead[] }>("GET", `workspaces/${ws}/leads`, undefined, q as Query),
  assignees: (ws: string) => call<Person[]>("GET", `workspaces/${ws}/lead-assignees`),
  lead: (id: string) => call<LeadDetail>("GET", `leads/${id}`),
  patchLead: (id: string, body: { status?: LeadStatus; assignee_id?: string | null }) => call<LeadDetail>("PATCH", `leads/${id}`, body),
  addNote: (id: string, body: string) => call<LeadNote>("POST", `leads/${id}/notes`, { body }),
  bulkLeads: (ws: string, body: { action: "assign" | "status"; ids: string[]; assignee_id?: string | null; status?: LeadStatus }) =>
    call<LeadBulkResult>("POST", `workspaces/${ws}/leads/bulk`, body),
  /**
   * Download the contacts spreadsheet with the filters of the list. The file is saved from the answer so the page can see the
   * header that says the file was cut at the row limit (`truncated`).
   */
  downloadLeadsCsv: async (ws: string, q: LeadQuery, notes: boolean): Promise<{ truncated: boolean }> => {
    const waiting = waitingError();
    if (waiting) throw waiting;
    let res: Response;
    try {
      res = await fetch(`/api/proxy/workspaces/${ws}/leads.csv${qs({ ...q, limit: undefined, offset: undefined, notes: notes ? 1 : undefined })}`, { credentials: "same-origin" });
    } catch {
      throw new ApiError(0, "network_error", runtimeT("err.offline"));
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as Parameters<typeof errorFromResponse>[1];
      throw errorFromResponse(res, json);
    }
    const blob = await res.blob();
    const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "")?.[1];
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name ? decodeURIComponent(name) : "contacts.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return { truncated: !!res.headers.get("x-rows-truncated") };
  },

  // webhooks
  webhooks: (ws: string) => call<{ events: WebhookEvent[]; results: Webhook[] }>("GET", `workspaces/${ws}/webhooks`),
  createWebhook: (ws: string, body: { url: string; name?: string; events: WebhookEvent[] }) => call<Webhook>("POST", `workspaces/${ws}/webhooks`, body),
  updateWebhook: (ws: string, id: string, body: Partial<{ url: string; name: string; events: WebhookEvent[]; enabled: boolean }>) =>
    call<Webhook>("PATCH", `workspaces/${ws}/webhooks/${id}`, body),
  deleteWebhook: (ws: string, id: string) => call<undefined>("DELETE", `workspaces/${ws}/webhooks/${id}`),
  testWebhook: (ws: string, id: string) => call<Delivery>("POST", `workspaces/${ws}/webhooks/${id}/test`, {}),
  newSecret: (ws: string, id: string) => call<Webhook>("POST", `workspaces/${ws}/webhooks/${id}/secret`, {}),
  deliveries: (ws: string, id: string) => call<{ count: number; results: Delivery[] }>("GET", `workspaces/${ws}/webhooks/${id}/deliveries`, undefined, { limit: 30 }),
  delivery: (ws: string, id: string, did: string) => call<Delivery>("GET", `workspaces/${ws}/webhooks/${id}/deliveries/${did}`),

  // analytics
  overview: (ws: string, q: AnalyticsQuery) => call<Analytics>("GET", `workspaces/${ws}/analytics`, undefined, q as Query),
  people: (ws: string, q: AnalyticsQuery) => call<PeopleResult>("GET", `workspaces/${ws}/analytics/people`, undefined, q as Query),
  departments: (ws: string, q: AnalyticsQuery) => call<DepartmentsResult>("GET", `workspaces/${ws}/analytics/departments`, undefined, q as Query),
  links: (ws: string, q: AnalyticsQuery) => call<LinksResult>("GET", `workspaces/${ws}/analytics/links`, undefined, q as Query),
  sources: (ws: string, q: AnalyticsQuery) => call<SourcesResult>("GET", `workspaces/${ws}/analytics/sources`, undefined, q as Query),

  // weekly report
  reportPrefs: (ws: string) => call<ReportPrefs>("GET", `workspaces/${ws}/report-preferences`),
  updateReportPrefs: (ws: string, body: Partial<{ personal_report: boolean; company_report: boolean }>) =>
    call<ReportPrefs>("PATCH", `workspaces/${ws}/report-preferences`, body),
  reportPreview: (ws: string, kind: "personal" | "company", week: "last" | "current") =>
    call<ReportPreview>("GET", `workspaces/${ws}/reports/weekly/preview`, undefined, { kind, week }),
};
