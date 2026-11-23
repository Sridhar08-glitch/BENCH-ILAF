import { NextResponse, type NextRequest } from "next/server";
import { API_SERVER_URL } from "@/lib/config";
import { REFRESH_COOKIE, clearSessionCookies, setSessionCookies } from "@/lib/server/session";
import { visitorHeaders } from "@/lib/server/client-ip";
import { ORIGIN_REFUSED, originAllowed } from "@/lib/server/origin";
import { COOKIE_MAX_AGE, LANG_COOKIE, normaliseLocale } from "@/lib/i18n/config";

// Sign in (password or Google), register, accept an invite, restore an account and sign out. The tokens go into httpOnly cookies and
// never reach page scripts; the browser only gets the user (and workspace id for invites).
export const dynamic = "force-dynamic";

// The browser that remembered itself for 30 days of "no second step" keeps this token in its own cookie; the API keeps only its hash.
const DEVICE_COOKIE = "ilaf_dv";
const DEVICE_MAX_AGE = 30 * 24 * 60 * 60;
const SIGN_IN_ACTIONS = new Set(["login", "google", "restore", "accept-invite", "accept-invite-google"]);

async function forward(path: string, payload: unknown, lang: string, acceptLanguage: string, visitor: Record<string, string>, userAgent = ""): Promise<Response> {
  return fetch(`${API_SERVER_URL}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // The API lists signed-in devices by browser and system, so it needs the visitor's own User-Agent, not this server's.
      ...(userAgent ? { "X-Client-User-Agent": userAgent.slice(0, 400) } : {}),
      ...(lang ? { "X-Language": lang } : {}),
      ...(acceptLanguage ? { "Accept-Language": acceptLanguage } : {}),
      ...visitor,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  if (!originAllowed(req.method, req.headers)) return NextResponse.json(ORIGIN_REFUSED, { status: 403 });
  const { action } = await ctx.params;
  const lang = normaliseLocale(req.cookies.get(LANG_COOKIE)?.value) ?? "";
  const visitor = visitorHeaders(req.headers);
  const userAgent = req.headers.get("user-agent") ?? "";

  if (action === "logout") {
    // Revoke the refresh token on the API, then clear the cookies whether or not that worked (the API may be down).
    const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
    if (refresh) {
      try {
        await forward("auth/logout", { refresh }, lang, "", visitor);
      } catch {
        /* the person is signed out here either way */
      }
    }
    const res = NextResponse.json({ ok: true });
    clearSessionCookies(res);
    return res;
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: { code: "validation_error", message: "Invalid request." } }, { status: 400 });
  }

  let path: string;
  const outgoing: Record<string, unknown> = payload;
  // A remembered browser sends its token so the API can skip the second step.
  const deviceToken = req.cookies.get(DEVICE_COOKIE)?.value;
  if (deviceToken && SIGN_IN_ACTIONS.has(action)) outgoing.device_token = deviceToken;
  if (action === "login") path = "auth/login";
  else if (action === "login-mfa") path = "auth/login/mfa";
  else if (action === "register") path = "auth/register";
  else if (action === "google") path = "auth/google";
  else if (action === "restore") path = "auth/restore";
  else if (action === "accept-invite" || action === "accept-invite-google") {
    // The token travels in the body, so it never shows up in an API address or its logs.
    const token = payload.token;
    if (typeof token !== "string" || !/^[\w-]{6,200}$/.test(token)) {
      return NextResponse.json({ error: { code: "invite_invalid", message: "This invitation link is not valid." } }, { status: 410 });
    }
    path = action === "accept-invite" ? "invites/accept" : "invites/accept-google";
  } else {
    return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await forward(path, outgoing, lang, req.headers.get("accept-language") ?? "", visitor, userAgent);
  } catch {
    return NextResponse.json(
      { error: { code: "network_error", message: "The service cannot be reached right now. Please try again." } },
      { status: 502 },
    );
  }

  const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  if (!upstream.ok) {
    const retry = upstream.headers.get("retry-after");
    return NextResponse.json(data, { status: upstream.status, ...(retry ? { headers: { "Retry-After": retry } } : {}) });
  }

  const { access, refresh, device_token: newDevice, ...safe } = data as { access?: string; refresh?: string; device_token?: string } & Record<string, unknown>;
  const res = NextResponse.json(safe, { status: upstream.status });
  if (access && refresh) setSessionCookies(res, { access, refresh });
  if (typeof newDevice === "string" && newDevice) {
    res.cookies.set(DEVICE_COOKIE, newDevice, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1", path: "/", maxAge: DEVICE_MAX_AGE });
  }
  // The account's language wins and is mirrored into the cookie, so every device follows it after sign-in.
  // An account that has none yet takes the language the visitor already chose on this device.
  const user = (safe as { user?: { language?: string | null } }).user;
  const saved = normaliseLocale(user?.language);
  if (saved) res.cookies.set(LANG_COOKIE, saved, { path: "/", maxAge: COOKIE_MAX_AGE, sameSite: "lax" });
  else if (lang && access) {
    void fetch(`${API_SERVER_URL}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}`, ...visitor },
      body: JSON.stringify({ language: lang }),
      cache: "no-store",
    }).catch(() => undefined);
  }
  return res;
}
