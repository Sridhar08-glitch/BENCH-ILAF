import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { LANG_COOKIE } from "@/lib/i18n/config";
import { isCompanySize } from "@/lib/staff-admin/sizes";
import { postJson, seeOther, textFields } from "@/lib/server/public-form";

// The "Talk to us" form posts here (no script needed) and is sent back to the page with the result.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const f = textFields(await req.formData(), ["company", "name", "email", "size", "message", "website"]);
  if (!f.company || !f.name || !f.email || (f.size && !isCompanySize(f.size))) return seeOther("/request-access?error=1");
  const lang = (await cookies()).get(LANG_COOKIE)?.value ?? null;
  const ok = await postJson("/public/company-leads", { company: f.company, name: f.name, email: f.email, size: f.size ?? "", message: f.message ?? "", website: f.website ?? "", source: "website" }, req.headers, lang);
  return seeOther(ok ? "/request-access?sent=1" : "/request-access?error=1");
}
