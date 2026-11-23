// API calls for API keys and the CRM connectors (Settings > Developers and Integrations).
import { ApiError, errorFromResponse, waitingError } from "../api";
import { tk, type MessageKey, type TFunction } from "../i18n";
import { runtimeT } from "../i18n";
import { apiErrorText } from "@/lib/i18n/api-error";

export type ApiKey = {
  id: string; name: string; prefix: string; scopes: string[]; status: "active" | "revoked" | "expired";
  expires_at: string | null; allowed_ips: string[]; rate_limit: { per_minute: number; per_day: number };
  created_at: string; created_by: string | null; last_used_at: string | null; use_count: number; requests_today: number;
  revoked_at: string | null; secret?: string;
};
export type KeysResult = { scopes: { key: string; label: string }[]; max_keys: number; results: ApiKey[] };

export type CrmSettings = { sync_new_leads: boolean; add_note: boolean; assign_owner: boolean; sync_status: boolean; status_map: Record<string, string> };
export type CrmConnection = {
  id: string; status: "connected" | "disabled"; health: "ok" | "retrying" | "failing" | "needs_reconnect"; region: string; account: string;
  connected_at: string; last_sync_at: string | null; last_success_at: string | null; last_error: string; last_error_code: string;
  last_error_at: string | null; disabled_reason: string; consecutive_failures: number; pending: number;
  mapping: Record<string, string>; settings: CrmSettings; status_map: Record<string, string>;
};
export type CrmVendor = {
  vendor: "hubspot" | "salesforce" | "zoho"; label: string; available: boolean; redirect_uri: string; regions: string[] | null;
  defaults: { mapping: Record<string, string>; status_map: Record<string, string> }; connection: CrmConnection | null;
};
export type CrmOverview = { lead_fields: string[]; statuses: string[]; vendors: CrmVendor[] };
export type CrmJob = { id: string; kind: string; status: "pending" | "success" | "failed"; attempts: number; name: string; error_code: string; error: string; created_at: string };
export type CrmTest = { ok: boolean; code: string; detail: string; remote_id: string; action: string; connection: CrmConnection };

async function call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
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
    res = await fetch(`/api/proxy/${path}`, init);
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

export const integrations = {
  keys: (ws: string) => call<KeysResult>("GET", `workspaces/${ws}/api-keys`),
  createKey: (ws: string, body: { name: string; scopes: string[]; expires_at?: string | null; allowed_ips?: string[] }) => call<ApiKey>("POST", `workspaces/${ws}/api-keys`, body),
  revokeKey: (ws: string, id: string) => call<ApiKey>("POST", `workspaces/${ws}/api-keys/${id}/revoke`),
  rotateKey: (ws: string, id: string, grace_hours: number) => call<{ old: ApiKey; new: ApiKey }>("POST", `workspaces/${ws}/api-keys/${id}/rotate`, { grace_hours }),
  crm: (ws: string) => call<CrmOverview>("GET", `workspaces/${ws}/crm`),
  connect: (ws: string, vendor: string, region?: string) => call<{ authorize_url: string }>("POST", `workspaces/${ws}/crm/${vendor}/connect`, { region }),
  disconnect: (ws: string, vendor: string) => call<unknown>("POST", `workspaces/${ws}/crm/${vendor}/disconnect`),
  saveCrm: (ws: string, vendor: string, body: { mapping?: Record<string, string>; settings?: Partial<CrmSettings> }) => call<CrmConnection>("PATCH", `workspaces/${ws}/crm/${vendor}`, body),
  testLead: (ws: string, vendor: string) => call<CrmTest>("POST", `workspaces/${ws}/crm/${vendor}/test`),
  backfill: (ws: string, vendor: string) => call<{ queued: number }>("POST", `workspaces/${ws}/crm/${vendor}/backfill`),
  jobs: (ws: string, vendor: string) => call<{ results: CrmJob[] }>("GET", `workspaces/${ws}/crm/${vendor}/jobs`),
};

/** Error codes the settings pages show in the reader's language instead of the server's sentence. */
export const CODE_TEXT: Record<string, MessageKey> = {
  crm_auth_revoked: tk("dev.e_crm_auth_revoked"),
  crm_token_unreadable: tk("dev.e_crm_token_unreadable"),
  crm_rate_limited: tk("dev.e_crm_rate_limited"),
  crm_unavailable: tk("dev.e_crm_unavailable"),
  crm_forbidden: tk("dev.e_crm_forbidden"),
  crm_rejected: tk("dev.e_crm_rejected"),
  crm_bad_mapping: tk("dev.e_crm_bad_mapping"),
  crm_oauth_failed: tk("dev.e_crm_oauth_failed"),
  crm_oauth_denied: tk("dev.e_crm_oauth_denied"),
  crm_invalid_state: tk("dev.e_crm_invalid_state"),
  crm_not_configured: tk("dev.e_crm_not_configured"),
  crm_already_connected: tk("dev.e_crm_already_connected"),
  crm_not_connected: tk("dev.e_crm_not_connected"),
  crm_disabled: tk("dev.e_crm_disabled"),
  subscription_required: tk("dev.e_subscription_required"),
  plan_limit: tk("dev.errLimit"),
};

/** The words for an error code, or the fallback text when the code is not one of ours. */
export function codeText(code: string | undefined, t: TFunction, fallback: string): string {
  const key = code ? CODE_TEXT[code] : undefined;
  return key ? t(key) : fallback;
}

/** What to show for a failed call: the text for its code, else the server's own (already translated) message. */
export function errorText(e: unknown, t: TFunction): string {
  if (!(e instanceof ApiError)) return t("dev.errGeneric");
  return codeText(e.code, t, apiErrorText(e, t, "dev.errGeneric"));
}
