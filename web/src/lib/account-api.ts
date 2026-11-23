// API calls for sign-in methods, privacy (export and deletion) and Google Wallet.
// They follow the contract sections "Sign in with Google", "Privacy and data" and "Google Wallet".
import { ApiError, errorFromResponse, waitingError, type SignInResult } from "./api";
import { runtimeT } from "./i18n";
import type { User } from "./types";

export type DataRequestKind = "export" | "delete";
export type DataRequestStatus = "pending" | "processing" | "ready" | "completed" | "cancelled" | "expired" | "failed";

export interface DataRequest {
  id: string;
  kind: DataRequestKind;
  scope: "user" | "workspace";
  workspace_id: string | null;
  workspace_name: string | null;
  status: DataRequestStatus;
  requested_at: string;
  due_at: string;
  completed_at: string | null;
  ready_at: string | null;
  expires_at: string | null;
  download_available: boolean;
  file_size: number;
  scheduled_for: string | null;
  error: string | null;
}

export interface CompanySecurity {
  allowed_email_domains: string[];
  require_google_signin: boolean;
  require_2fa?: boolean;
}

/** Proof that the person is who they say: their password, or a Google sign-in made a moment ago. */
export interface Confirmation {
  password?: string;
  credential?: string;
}

async function call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, via: "proxy" | "session" = "proxy"): Promise<T> {
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

export const authApi = {
  /** Sign in (or sign up) with a Google ID token. Sets the session cookies on the server. */
  google: (credential: string) => call<SignInResult>("POST", "google", { credential }, "session"),
  /** Bring back an account inside its deletion grace period: the e-mailed token, or password, or a Google sign-in. */
  restore: (body: { token: string } | { email: string; password: string } | { credential: string }) =>
    call<SignInResult>("POST", "restore", body, "session"),
  acceptInviteGoogle: (token: string, credential: string) =>
    call<{ workspace_id: string } | { mfa_required: true; mfa_token: string; methods: ("totp" | "recovery")[]; workspace_id: string }>("POST", "accept-invite-google", { token, credential }, "session"),
  /** The three sensitive changes below take `proof` (password or fresh Google credential) when the API asks for it (403 reauth_required). */
  linkGoogle: (credential: string, proof?: Confirmation) =>
    call<User>("POST", "auth/google/link", { ...(proof?.password ? { password: proof.password } : {}), credential }),
  unlinkGoogle: (proof?: Confirmation) => call<User>("POST", "auth/google/unlink", { ...proof }),
  setPassword: (new_password: string, proof?: Confirmation) => call<undefined>("POST", "auth/set-password", { new_password, ...proof }),
};

export const privacyApi = {
  requests: () => call<DataRequest[]>("GET", "privacy/requests"),
  startExport: (workspaceId?: string, proof?: Confirmation) =>
    call<DataRequest>("POST", "privacy/export", { ...(workspaceId ? { workspace_id: workspaceId } : {}), ...proof }),
  downloadLink: (id: string, proof?: Confirmation) =>
    call<{ url: string; expires_at: string }>("POST", `privacy/requests/${id}/download-link`, { ...proof }),
  /** The link token goes in the body, never in the address. */
  checkDownload: (token: string) =>
    call<{ valid: boolean; scope: "user" | "workspace"; expires_at: string; file_size: number }>("POST", "privacy/download/check", { token }),
  deleteAccount: (body: Confirmation & { confirm: string }) => call<DataRequest>("POST", "privacy/delete-account", body),
  deleteCompany: (workspaceId: string, body: Confirmation & { confirm_name: string }) =>
    call<DataRequest>("POST", `privacy/workspaces/${workspaceId}/delete`, body),
  restoreCompany: (workspaceId: string) => call<{ restored: boolean }>("POST", `privacy/workspaces/${workspaceId}/restore`, {}),
  saveSecurity: (workspaceId: string, security: Partial<CompanySecurity>) =>
    call<{ security: CompanySecurity | null }>("PATCH", `workspaces/${workspaceId}`, { security }),
};

/** Download a data export. The one-time token is sent in the body of a POST (not in the address) and the file is saved from the answer. */
export async function downloadExport(token: string): Promise<void> {
  const waiting = waitingError();
  if (waiting) throw waiting;
  let res: Response;
  try {
    res = await fetch("/api/proxy/privacy/download", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    throw new ApiError(0, "network_error", runtimeT("settings.offline"));
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as Parameters<typeof errorFromResponse>[1];
    throw errorFromResponse(res, json, "settings.genericError");
  }
  const blob = await res.blob();
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "")?.[1];
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name ? decodeURIComponent(name) : "export.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export const walletApi = {
  google: (cardId: string) => call<{ save_url: string; warnings: string[] }>("GET", `cards/${cardId}/wallet/google`),
};
