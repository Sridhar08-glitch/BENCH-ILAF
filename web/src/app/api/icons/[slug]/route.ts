import { NextResponse } from "next/server";
import { brandIcon } from "@/lib/server/icons";

// One logo (its SVG path and colour) on demand.
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const icon = brandIcon(slug);
  if (!icon) return NextResponse.json({ error: { code: "not_found", message: "Unknown logo." } }, { status: 404 });
  return NextResponse.json(icon, { headers: { "Cache-Control": "public, max-age=604800, immutable" } });
}
