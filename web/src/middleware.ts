import { NextResponse, type NextRequest } from "next/server";

// Signed-out visitors are sent to the sign-in page before any dashboard screen loads.
export function middleware(req: NextRequest) {
  const signedIn = req.cookies.has("ilaf_rt") || req.cookies.has("ilaf_at");
  if (signedIn) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/app", "/app/:path*", "/staff", "/staff/:path*"] };
