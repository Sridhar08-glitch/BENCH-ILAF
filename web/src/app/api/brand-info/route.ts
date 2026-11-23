import { NextResponse, type NextRequest } from "next/server";
import { toCompanyBrand } from "@/lib/library/company/brand";
import { measureBrand } from "@/lib/server/brand-info";
import type { BrandLook } from "@/lib/types";

// Measures a company's pictures for the editor and the brand page (the public page measures them while it draws the card).
// The body is the company brand as the API spells it; the answer is what was measured about its pictures.
// Only signed-in people may ask, and only pictures that live on the API's own address are ever read.
export async function POST(req: NextRequest) {
  if (!req.cookies.has("ilaf_rt") && !req.cookies.has("ilaf_at")) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const brand = toCompanyBrand({
    company_name: typeof b.companyName === "string" ? b.companyName : "", logo_url: b.logoUrl as string | null, symbol_url: b.symbolUrl as string | null,
    palette: b.palette as BrandLook["palette"], colours: b.colours as BrandLook["colours"], logo_display: b.logoDisplay as BrandLook["logo_display"],
    show_company_name: b.showName as boolean, artwork: b.artwork as BrandLook["artwork"], background_url: b.backgroundUrl as string | null,
    template_front_url: b.templateFrontUrl as string | null, template_back_url: b.templateBackUrl as string | null,
  });
  if (!brand) return NextResponse.json({}, { status: 200 });
  return NextResponse.json(await measureBrand(brand), { headers: { "Cache-Control": "private, max-age=60" } });
}
