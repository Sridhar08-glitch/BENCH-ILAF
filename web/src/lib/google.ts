// Sign in with Google (Google Identity Services). The OAuth client id is public and comes from
// NEXT_PUBLIC_GOOGLE_CLIENT_ID; when it is empty the Google buttons are hidden and nothing else changes.
import { runtimeT, type TFunction } from "./i18n";

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
export const GSI_SRC = "https://accounts.google.com/gsi/client";

export const googleEnabled = (): boolean => GOOGLE_CLIENT_ID.length > 0;

export interface GsiCredentialResponse {
  credential?: string;
}

interface GsiApi {
  accounts: {
    id: {
      initialize: (o: { client_id: string; callback: (r: GsiCredentialResponse) => void; ux_mode?: string; auto_select?: boolean }) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GsiApi;
  }
}

let loading: Promise<void> | null = null;

/** Load Google's script once, only when a page that needs it asks. */
export function loadGsi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Google sign-in could not be loaded"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Plain words for the errors the Google sign-in endpoints answer with. */
export function googleErrorText(code: string, fallback: string, t: TFunction = runtimeT): string {
  switch (code) {
    case "google_token_invalid":
      return t("settings.googleNotConfirmed");
    case "google_email_unverified":
      return t("settings.googleEmailUnverified");
    case "account_exists_unverified":
      return t("settings.googleExistsUnverified");
    case "google_account_mismatch":
      return t("settings.googleMismatch");
    case "google_in_use":
      return t("settings.googleInUse");
    case "google_unavailable":
      return t("settings.googleUnavailable");
    case "google_not_configured":
      return t("settings.googleNotConfigured");
    default:
      return fallback;
  }
}
