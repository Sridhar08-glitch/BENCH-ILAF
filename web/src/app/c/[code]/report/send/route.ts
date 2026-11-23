import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { LANG_COOKIE } from "@/lib/i18n/config";
import { REPORT_REASONS, postJson, seeOther, textFields } from "@/lib/server/public-form";

// The "Report this card" form posts here. It works without scripts and answers with a redirect back to the form.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const page = `/c/${encodeURIComponent(code)}/report`;
  const f = textFields(await req.formData(), ["reason", "note", "email", "website"]);
  if (!(REPORT_REASONS as readonly string[]).includes(f.reason ?? "")) return seeOther(`${page}?error=1`);
  const lang = (await cookies()).get(LANG_COOKIE)?.value ?? null;
  const ok = await postJson(`/public/cards/${encodeURIComponent(code)}/report`, { reason: f.reason, note: f.note ?? "", email: f.email ?? "", website: f.website ?? "" }, req.headers, lang);
  return seeOther(ok ? `${page}?sent=1` : `${page}?error=1`);
}
