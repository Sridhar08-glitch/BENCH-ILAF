import { NextResponse, type NextRequest } from "next/server";
import { brandIcon } from "@/lib/server/icons";

// Logo paths for up to 60 brands in one call (used by the picker's result grid).
export function GET(req: NextRequest) {
  const slugs = (req.nextUrl.searchParams.get("slugs") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 60);
  const icons: Record<string, { path: string; hex: string; title: string }> = {};
  for (const s of slugs) {
    const b = brandIcon(s);
    if (b) icons[b.slug] = { path: b.path, hex: b.hex, title: b.title };
  }
  return NextResponse.json({ icons }, { headers: { "Cache-Control": "public, max-age=86400" } });
}
