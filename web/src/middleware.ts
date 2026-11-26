import { NextResponse, type NextRequest } from "next/server";
import { API_SERVER_URL, WEB_URL } from "@/lib/config";
import { createResolver } from "@/lib/domains/resolve";
import { CUSTOM_HEADERS, routeRequest, type Decision } from "@/lib/domains/route";

// One front door for two kinds of host (the decisions themselves live in lib/domains/route.ts, where they are tested):
//  - the Bench host: signed-out visitors are sent to the sign-in page before any dashboard screen loads;
//  - a company's own domain (Enterprise, verified): the API is asked which company it belongs to, and the visitor sees that company's
//    cards (https://cards.northgate.com/ahmed) or directory (/) at the address they typed. The dashboard is never served there.
const EXTRA_MAIN_HOSTS = (process.env.WEB_EXTRA_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
const resolveHost = createResolver({ apiUrl: API_SERVER_URL });

function cleanHeaders(req: NextRequest, drop: readonly string[] = [], set: Record<string, string> = {}): Headers {
  const headers = new Headers(req.headers);
  for (const name of drop) headers.delete(name);
  for (const [name, value] of Object.entries(set)) headers.set(name, value);
  return headers;
}

function respond(req: NextRequest, d: Decision): NextResponse {
  switch (d.type) {
    case "next":
      return NextResponse.next({ request: { headers: cleanHeaders(req, d.drop) } });
    case "redirect": {
      if (!d.location.startsWith("/")) return NextResponse.redirect(new URL(d.location), d.status);
      const target = new URL(d.location, "http://x");
      const url = req.nextUrl.clone();
      url.pathname = target.pathname;
      url.search = target.search;
      return NextResponse.redirect(url, d.status);
    }
    case "rewrite": {
      const url = req.nextUrl.clone();
      url.pathname = d.pathname;
      url.search = d.search;
      // Headers a visitor sent that look like ours are replaced (or removed); only the middleware sets them.
      return NextResponse.rewrite(url, { request: { headers: cleanHeaders(req, CUSTOM_HEADERS, d.headers) } });
    }
    case "unavailable":
      return new NextResponse("Temporarily unavailable.", { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } });
    case "notfound": {
      // A path that does not exist: Next answers its plain 404 page. Nothing says which company, if any, held the name.
      const url = req.nextUrl.clone();
      url.pathname = "/_bench-not-found";
      url.search = "";
      const res = NextResponse.rewrite(url, { request: { headers: cleanHeaders(req, CUSTOM_HEADERS) } });
      res.headers.set("X-Robots-Tag", "noindex");
      res.headers.set("Cache-Control", "no-store");
      return res;
    }
  }
}

export async function middleware(req: NextRequest) {
  const signedIn = req.cookies.has("ilaf_rt") || req.cookies.has("ilaf_at");
  const decision = await routeRequest(
    {
      host: req.headers.get("host") ?? req.headers.get("x-forwarded-host"),
      pathname: req.nextUrl.pathname,
      search: req.nextUrl.search,
      signedIn,
      webUrl: WEB_URL,
      extraMainHosts: EXTRA_MAIN_HOSTS,
    },
    resolveHost,
  );
  return respond(req, decision);
}

// Everything except the built files and the static folders (they are the same on every host and never need a decision).
// The dashboard and staff paths are listed on their own as well so it stays plain that they are always covered.
export const config = {
  matcher: ["/app", "/app/:path*", "/staff", "/staff/:path*", "/((?!_next/static|_next/image|card-library|card-fonts|og-fonts|brand|ocr|favicon.ico).*)"],
};
