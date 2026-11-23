// API calls of Settings > Security, Devices, Notifications and the company trust settings (verified domains, e-mail look).
import { ApiError, errorFromResponse, waitingError } from "./api";
import type { Confirmation } from "./account-api";
import { runtimeT } from "./i18n";
import type { TwoFactorSummary } from "./types";

async function call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, via: "proxy" | "session" = "proxy"): Promise<T> {
  const url = via === "session" ? `/api/session/${path}` : `/api/proxy/${path}`;
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  if (method !== "GET" && via !== "session") {
    const waiting = waitingError();
    if (waiting) throw waiting;
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, "network_error", runtimeT("settings.offline"));
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw errorFromResponse(res, json as Parameters<typeof errorFromResponse>[1], "settings.genericError");
  return json as T;
}

// ---------------------------------------------------------------- 2-step verification
export interface TwoFactorStatus extends TwoFactorSummary {
  recovery_codes_left: number;
  trusted_devices: number;
}

export interface TwoFactorSetup {
  secret: string;
  otpauth_uri: string;
  issuer: string;
  account: string;
}

/** What a sign-in answers when the account has 2-step verification: no tokens yet, only a short-lived step token. */
export interface MfaChallenge {
  mfa_required: true;
  mfa_token: string;
  methods: ("totp" | "recovery")[];
}

export function isMfaChallenge(v: unknown): v is MfaChallenge {
  return !!v && typeof v === "object" && (v as { mfa_required?: unknown }).mfa_required === true && typeof (v as { mfa_token?: unknown }).mfa_token === "string";
}

export const twoFactorApi = {
  status: () => call<TwoFactorStatus>("GET", "auth/2fa"),
  setup: (proof?: Confirmation) => call<TwoFactorSetup>("POST", "auth/2fa/setup", { ...proof }),
  confirm: (code: string) => call<TwoFactorStatus & { recovery_codes: string[] }>("POST", "auth/2fa/confirm", { code }),
  newRecoveryCodes: (code: string) => call<TwoFactorStatus & { recovery_codes: string[] }>("POST", "auth/2fa/recovery-codes", { code }),
  disable: (body: Confirmation & { code?: string; recovery_code?: string }) => call<TwoFactorStatus>("POST", "auth/2fa/disable", body),
  /** The second step of a sign-in. Goes through the cookie route so the tokens never reach the page. */
  signInStep: (b: { mfa_token: string; code?: string; recovery_code?: string; remember_device?: boolean }) =>
    call<{ user: unknown; recovery_codes_left?: number }>("POST", "login-mfa", b, "session"),
};

// ---------------------------------------------------------------- devices
export interface DeviceSession {
  id: string;
  label: string | null;
  kind: "phone" | "tablet" | "desktop" | "other";
  /** The address with its last part hidden ("203.0.113.x"). */
  ip: string | null;
  country: string | null;
  created_at: string;
  last_used_at: string;
  current: boolean;
}

export interface TrustedDevice {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
}

export interface DevicesResponse {
  current_session_id: string | null;
  sessions: DeviceSession[];
  trusted_devices: TrustedDevice[];
  events: { action: string; detail: string; ip: string | null; created_at: string }[];
}

export const devicesApi = {
  list: () => call<DevicesResponse>("GET", "auth/devices"),
  signOut: (id: string) => call<undefined>("DELETE", `auth/devices/${id}`),
  signOutOthers: () => call<{ signed_out: number }>("POST", "auth/devices/sign-out-others", {}),
  forgetTrusted: (id: string) => call<undefined>("DELETE", `auth/trusted-devices/${id}`),
};

// ---------------------------------------------------------------- notifications
export interface NotifyPrefs {
  push_available: boolean;
  vapid_public_key: string | null;
  push_leads: boolean;
  push_support: boolean;
  daily_summary: boolean;
  timezone: string;
  subscriptions: number;
}

export const notifyApi = {
  prefs: () => call<NotifyPrefs>("GET", "notifications/prefs"),
  update: (b: Partial<Pick<NotifyPrefs, "push_leads" | "push_support" | "daily_summary" | "timezone">>) => call<NotifyPrefs>("PATCH", "notifications/prefs", b),
  subscribe: (sub: PushSubscriptionJSON) => call<NotifyPrefs>("POST", "notifications/push/subscribe", sub),
  unsubscribe: (endpoint: string) => call<NotifyPrefs>("POST", "notifications/push/unsubscribe", { endpoint }),
  test: () => call<{ sent: number }>("POST", "notifications/push/test", {}),
};

// ---------------------------------------------------------------- company trust
export interface VerifiedDomainRow {
  id: string;
  domain: string;
  status: "pending" | "verified" | "expired";
  method: string;
  sent_to: string | null;
  created_at: string;
  verified_at: string | null;
  expires_at: string | null;
  mail_sent?: boolean;
}

export interface EmailPreview {
  subject: string;
  html: string;
  text: string;
  lang: string;
  from: string | null;
  reply_to: string | null;
  has_logo: boolean;
}

export const companyTrustApi = {
  domains: (ws: string) => call<{ domains: VerifiedDomainRow[] }>("GET", `workspaces/${ws}/domains`),
  claimDomain: (ws: string, domain: string, mailbox?: string) =>
    call<VerifiedDomainRow>("POST", `workspaces/${ws}/domains`, { domain, ...(mailbox ? { mailbox } : {}) }),
  verifyDomain: (ws: string, id: string, code: string) => call<VerifiedDomainRow>("POST", `workspaces/${ws}/domains/${id}/verify`, { code }),
  removeDomain: (ws: string, id: string) => call<undefined>("DELETE", `workspaces/${ws}/domains/${id}`),
  /** The link in the confirmation e-mail: works for whoever reads that mailbox, signed in or not. */
  confirmLink: (token: string) => call<{ domain: string; company: string; status: string }>("POST", "domains/confirm", { token }),
  replyTo: (ws: string) => call<{ reply_to_email: string }>("GET", `workspaces/${ws}/email-settings`),
  saveReplyTo: (ws: string, reply_to_email: string) => call<{ reply_to_email: string }>("PATCH", `workspaces/${ws}/email-settings`, { reply_to_email }),
  emailPreview: (ws: string, lang: string) => call<EmailPreview>("GET", `workspaces/${ws}/email-preview?lang=${encodeURIComponent(lang)}`),
  setRequire2fa: (ws: string, require_2fa: boolean) =>
    call<unknown>("PATCH", `workspaces/${ws}`, { security: { require_2fa } }),
};

// ---------------------------------------------------------------- cards (several per person)
export const cardOrderApi = {
  reorder: (ws: string, ids: string[]) => call<unknown>("POST", `workspaces/${ws}/cards/reorder`, { ids }),
  makeDefault: (id: string) => call<unknown>("POST", `cards/${id}/make-default`, {}),
};

/** Upload the PDF of a "Download file" button. Answers with the address to store as the button's value. */
export async function uploadCardFile(cardId: string, file: File): Promise<{ file_url: string; size: number }> {
  const waiting = waitingError();
  if (waiting) throw waiting;
  const form = new FormData();
  form.append("file", file);
  let res: Response;
  try {
    res = await fetch(`/api/proxy/cards/${cardId}/file`, { method: "POST", credentials: "same-origin", body: form });
  } catch {
    throw new ApiError(0, "network_error", runtimeT("settings.offline"));
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw errorFromResponse(res, json as Parameters<typeof errorFromResponse>[1], "settings.genericError");
  return json as unknown as { file_url: string; size: number };
}
