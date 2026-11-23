import { APP_NAME } from "@/lib/config";
import { CATALOGUES } from "@/lib/i18n/messages";
import { fetchPublicCard } from "@/lib/public-api";
import { normalizeDesign, resolveColours } from "@/lib/library";
import { toCompanyBrand } from "@/lib/library/company/brand";
import { mostlyArabic } from "@/lib/card/bidi";
import { ogCache, cacheKey } from "@/lib/og/cache";
import { renderCardOg, renderGenericOg } from "@/lib/og/compose";
import { fetchImage } from "@/lib/og/fetch";

// The picture a chat app or social site shows when a card link is pasted: 1200 x 630, drawn on the server from what the
// public card page already shows (name, title, company, photo, company logo, the card's colours). A card that is missing,
// paused or removed gets a plain picture with only the product name.
export const runtime = "nodejs";

// Neither picture is kept by browsers or the network edge: a card that was just unpublished, paused or deleted must stop
// showing its name at once. The drawn picture itself is kept on the server by content (see lib/og/cache.ts), so a repeat
// request costs a card lookup, not a new drawing.
const LIVE_CACHE = "no-store";
const GENERIC_CACHE = "no-store";

function png(body: Buffer, cache: string): Response {
  return new Response(new Uint8Array(body), { headers: { "Content-Type": "image/png", "Cache-Control": cache } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await params;
  const data = await fetchPublicCard(code).catch(() => null);

  if (!data || data.state !== "live") {
    const key = cacheKey({ generic: "1" });
    const img = await ogCache.getOrMake(key, () => renderGenericOg({ appName: APP_NAME, line: CATALOGUES.en["growth.ogFooter"] }));
    return png(img, GENERIC_CACHE);
  }

  const { card } = data;
  const brand = toCompanyBrand(card.brand);
  const design = normalizeDesign(card.design);
  const rtl = card.language === "ar" || (card.language !== "en" && mostlyArabic(`${card.name} ${card.title} ${card.company}`));
  const colours = resolveColours(design, brand?.palette ?? null);
  const logoUrl = brand?.logoUrl || brand?.symbolUrl || null;
  const key = cacheKey({
    code: data.canonical, name: card.name, title: card.title, company: card.company, photo: card.photo_url ?? "", logo: logoUrl ?? "",
    design: JSON.stringify([colours.bg, colours.bg2, colours.fg, colours.acc, colours.on, rtl]),
  });
  const img = await ogCache.getOrMake(key, async () => {
    const [photo, logo] = await Promise.all([fetchImage(card.photo_url), fetchImage(logoUrl)]);
    return renderCardOg({
      name: card.name, title: card.title, company: card.company, photo, logo,
      colours: { bg: colours.bg, bg2: colours.bg2, fg: colours.fg, acc: colours.acc, on: colours.on },
      appName: APP_NAME, footer: CATALOGUES[rtl ? "ar" : "en"]["growth.ogFooter"], rtl,
    });
  });
  return png(img, LIVE_CACHE);
}
