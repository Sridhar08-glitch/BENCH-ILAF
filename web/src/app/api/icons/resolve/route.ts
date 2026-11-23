import { NextResponse } from "next/server";
import { resolveItemIcons } from "@/lib/server/icons";

// Logos for a list of buttons, used by the editor preview so it matches the public page.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "validation_error", message: "Invalid request." } }, { status: 400 });
  }
  const raw = (body as { items?: unknown })?.items;
  if (!Array.isArray(raw)) return NextResponse.json({ icons: [] });
  const items = raw.slice(0, 60).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const icon = o.icon as { type?: string; key?: string | null; image_url?: string | null } | null | undefined;
    return {
      kind: String(o.kind ?? "Custom"),
      value: String(o.value ?? "").slice(0, 2000),
      icon: icon ? { type: (icon.type ?? "auto") as "auto", key: icon.key ?? null, image_url: icon.image_url ?? null } : null,
    };
  });
  return NextResponse.json({ icons: resolveItemIcons(items) });
}
