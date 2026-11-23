import { NextResponse, type NextRequest } from "next/server";
import { API_SERVER_URL } from "@/lib/config";
import { LANG_COOKIE } from "@/lib/i18n/config";
import { visitorHeaders } from "@/lib/server/client-ip";
import { ORIGIN_REFUSED, originAllowed } from "@/lib/server/origin";
import { ACCESS_COOKIE, REFRESH_COOKIE, clearSessionCookies, refreshTokens, setSessionCookies, type Tokens } from "@/lib/server/session";

// Sends the browser's API calls to the real API with the signed-in token attached.
// When the token has expired it is refreshed here, once, and the call is repeated.
export const dynamic = "force-dynamic";

const PASS_HEADERS = ["content-type", "content-disposition", "cache-control", "retry-after", "x-rows-truncated", "etag"];

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!originAllowed(req.method, req.headers)) return NextResponse.json(ORIGIN_REFUSED, { status: 403 });
  const { path } = await ctx.params;
  const target = `${API_SERVER_URL}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;
  // Changing the password answers with new tokens for this device: they replace the cookies and never reach the page.
  const isPasswordChange = req.method === "POST" && path.join("/") === "auth/change-password";
  // Only the visitor address built here goes to the API; any X-BENCH-* header the browser sent is dropped.
  const visitor = visitorHeaders(req.headers);

  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  let fresh: Tokens | null = null;
  let refused = false;

  const rotate = async (): Promise<boolean> => {
    if (!refresh) return false;
    const r = await refreshTokens(refresh);
    if (r === null) {
      refused = true;
      return false;
    }
    if (r === "failed") return false;
    fresh = r;
    access = r.access;
    return true;
  };

  const call = (token?: string) => {
    const headers: Record<string, string> = { Accept: "application/json, text/csv, */*", ...visitor };
    const lang = req.cookies.get(LANG_COOKIE)?.value;
    if (lang) headers["X-Language"] = lang;
    const accept = req.headers.get("accept-language");
    if (accept) headers["Accept-Language"] = accept;
    // The API lists signed-in devices by browser and system (a new sign-in after a password change starts a device row).
    const ua = req.headers.get("user-agent");
    if (ua) headers["X-Client-User-Agent"] = ua.slice(0, 400);
    const ct = req.headers.get("content-type");
    if (ct) headers["Content-Type"] = ct;
    if (token) headers.Authorization = `Bearer ${token}`;
    // The second step of the staff area: a token from the authenticator check, kept by the page for this tab only.
    const staff = req.headers.get("x-staff-token");
    if (staff) headers["X-Staff-Token"] = staff;
    // Live chat: a signed-out visitor proves the chat is theirs with a token; the ETag lets an unchanged poll answer 304.
    const chat = req.headers.get("x-chat-token");
    if (chat) headers["X-Chat-Token"] = chat;
    const inm = req.headers.get("if-none-match");
    if (inm) headers["If-None-Match"] = inm;
    return fetch(target, { method: req.method, headers, body: body && body.byteLength ? body : undefined, cache: "no-store" });
  };

  if (!access && refresh) await rotate();

  let upstream: Response;
  try {
    upstream = await call(access);
    if (upstream.status === 401 && refresh && !fresh && !refused) {
      if (await rotate()) upstream = await call(access);
    }
  } catch {
    return NextResponse.json(
      { error: { code: "network_error", message: "The service cannot be reached right now. Please try again." } },
      { status: 502 },
    );
  }

  let changed: Tokens | null = null;
  let out: NextResponse;
  if (isPasswordChange && upstream.ok) {
    const j = (await upstream.json().catch(() => ({}))) as Partial<Tokens>;
    if (j.access && j.refresh) changed = { access: j.access, refresh: j.refresh };
    out = new NextResponse(null, { status: 204 });
  } else {
    out =
      upstream.status === 204 || upstream.status === 205 || upstream.status === 304
        ? new NextResponse(null, { status: upstream.status })
        : new NextResponse(upstream.body, { status: upstream.status });
    for (const h of PASS_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) out.headers.set(h, v);
    }
  }
  out.headers.set("Cache-Control", "no-store");
  if (changed) setSessionCookies(out, changed);
  else if (fresh) setSessionCookies(out, fresh);
  else if (refused) clearSessionCookies(out);
  return out;
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
