import { NextResponse } from "next/server";
import { brandIndex } from "@/lib/server/icons";

// Small search list for the logo picker, loaded only when the picker opens.
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(brandIndex(), { headers: { "Cache-Control": "public, max-age=86400" } });
}
