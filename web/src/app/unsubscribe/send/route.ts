import type { NextRequest } from "next/server";
import { postJson, seeOther, textFields } from "@/lib/server/public-form";

// Switches product-update e-mails off. The page's button posts a form here; a mail app's one-click unsubscribe posts
// the same way with the token in the address. A plain visit (GET) only goes to the page, so a link scanner changes nothing.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let token = req.nextUrl.searchParams.get("t") ?? "";
  if (!token) {
    try { token = textFields(await req.formData(), ["token"]).token ?? ""; } catch { token = ""; }
  }
  if (!token) return seeOther("/unsubscribe?error=1");
  const ok = await postJson("/unsubscribe", { token }, req.headers, null);
  return seeOther(ok ? "/unsubscribe?done=1" : "/unsubscribe?error=1");
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  return seeOther(token ? `/unsubscribe?t=${encodeURIComponent(token)}` : "/unsubscribe?error=1");
}
