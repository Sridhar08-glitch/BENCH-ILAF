import { NextResponse, type NextRequest } from "next/server";
import { detectBrand } from "@/lib/server/icons";

// Which brand a website host belongs to ({brand: null} when unknown).
export function GET(req: NextRequest) {
  const host = (req.nextUrl.searchParams.get("host") || "").slice(0, 253);
  const brand = host ? detectBrand(host) : null;
  return NextResponse.json({ brand }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
