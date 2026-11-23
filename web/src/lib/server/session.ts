// Sign-in tokens live in httpOnly cookies set by the web server, so page scripts can never read them.
// The browser talks to /api/proxy, which adds the token and refreshes it when it has expired.
import { NextResponse } from "next/server";
import { API_SERVER_URL } from "@/lib/config";

// Cookie names are internal identifiers read by the proxy, the middleware and the server pages;
// they are kept as they are so that no signed-in user is logged out by a product rename.
export const ACCESS_COOKIE = "ilaf_at";
export const REFRESH_COOKIE = "ilaf_rt";
const ACCESS_MAX_AGE = 55 * 60; // the token lasts 60 minutes; refresh a little early
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

export interface Tokens {
  access: string;
  refresh: string;
}

const base = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
  path: "/",
};

export function setSessionCookies(res: NextResponse, t: Tokens): void {
  res.cookies.set(ACCESS_COOKIE, t.access, { ...base, maxAge: ACCESS_MAX_AGE });
  res.cookies.set(REFRESH_COOKIE, t.refresh, { ...base, maxAge: REFRESH_MAX_AGE });
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(ACCESS_COOKIE, "", { ...base, maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { ...base, maxAge: 0 });
}

// The refresh token rotates, so two requests must never refresh with the same token at once.
const inflight = new Map<string, Promise<Tokens | null | "failed">>();

/**
 * Exchange a refresh token for new tokens.
 * null = the token was refused (sign the user out); "failed" = the API could not be reached (keep the session).
 */
export function refreshTokens(refresh: string): Promise<Tokens | null | "failed"> {
  const existing = inflight.get(refresh);
  if (existing) return existing;
  const p = (async (): Promise<Tokens | null | "failed"> => {
    try {
      const r = await fetch(`${API_SERVER_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
        cache: "no-store",
      });
      if (r.status === 401 || r.status === 400 || r.status === 403) return null;
      if (!r.ok) return "failed";
      const j = (await r.json()) as Partial<Tokens>;
      if (!j.access || !j.refresh) return null;
      return { access: j.access, refresh: j.refresh };
    } catch {
      return "failed";
    }
  })();
  inflight.set(refresh, p);
  // Keep the result for a few seconds so parallel requests that arrive just after reuse it.
  void p.finally(() => setTimeout(() => inflight.delete(refresh), 5000));
  return p;
}
