import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { fetchPublicCard } from "@/lib/public-api";
import { resolveItemIcons } from "@/lib/server/icons";
import { APP_NAME, WEB_URL } from "@/lib/config";
import { CardMarkup } from "@/components/card/CardMarkup";
import { Sections, visibleSections } from "@/components/card/sections/Sections";
import { splitTail } from "@/lib/library/tail";
import { normalizeDesign } from "@/lib/library";
import { buildInput, drawPage, renderTab, withoutScriptTabs } from "@/lib/library/render";
import { toCompanyBrand } from "@/lib/library/company/brand";
import { withBrandInfo } from "@/lib/server/brand-info";
import { PublicCard } from "./PublicCard";
import { StateScreen } from "./StateScreen";
import type { EventSource } from "@/lib/types";
import type { CardPageData } from "@/lib/library/types";
import { I18nBoundary } from "@/lib/i18n/Boundary";
import { cardLocale, dirOf, normaliseCardLanguage, type Locale } from "@/lib/i18n/config";
import { getI18n, getRequestLanguage } from "@/lib/i18n/server";
import { mostlyArabic } from "@/lib/card/bidi";
import { shortHash } from "@/lib/og/hash";
import { getCustomHost } from "@/lib/server/custom-host";
import { cardHref } from "@/lib/card-address";

// The public card page: server rendered, no sign-in, handles live / paused / suspended / unknown.
type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ s?: string | string[] }>;
};

const SOURCES: EventSource[] = ["nfc", "qr", "link", "email"];

function sourceOf(s: string | string[] | undefined): EventSource | null {
  const v = Array.isArray(s) ? s[0] : s;
  return SOURCES.includes(v as EventSource) ? (v as EventSource) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const { host } = await getCustomHost();
  const data = await fetchPublicCard(code, host).catch(() => null);
  const { t } = await getI18n();
  if (!data) return { title: t("card.metaNotFound"), robots: { index: false } };
  if (data.state !== "live") return { title: data.state === "paused" ? t("card.metaUnavailable") : t("card.metaRemoved"), robots: { index: false } };
  const { og, canonical, card } = data;
  // The API builds the main address: the company's own domain once it is verified, else <web>/c/<code>. It is the canonical one
  // and the one in the Open Graph tags, whichever of the two addresses was opened.
  const url = card.public_url || `${WEB_URL}/c/${canonical}`;
  // The picture is drawn by <address>/og.png; its address changes when the card's words or photo change, so chat apps that
  // remember a picture fetch the new one.
  const image = { url: `${url}/og.png?v=${shortHash(`${card.name}|${card.title}|${card.company}|${card.photo_url ?? ""}|${JSON.stringify(card.design)}`)}`, width: 1200, height: 630, alt: card.name };
  return {
    title: og.title,
    description: og.description,
    alternates: { canonical: url },
    // A card page stays out of search results unless its owner turned the setting on.
    robots: card.seo_indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title: og.title,
      description: og.description,
      url,
      siteName: APP_NAME,
      type: "profile",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: og.title,
      description: og.description,
      images: [{ url: image.url, alt: image.alt }],
    },
    other: { "og:profile:first_name": card.name },
  };
}

export default async function CardPage({ params, searchParams }: Props) {
  const { code } = await params;
  const sp = await searchParams;
  const { host, root } = await getCustomHost();
  const data = await fetchPublicCard(code, host);
  if (!data) notFound();
  const visitor = await getRequestLanguage();

  if (data.state === "paused") return <StateScreen kind="paused" companyName={data.company_name} message={data.message} />;
  if (data.state === "suspended") {
    return <StateScreen kind="suspended" companyName={data.company_name} message={data.message} website={data.website} />;
  }

  const source = sourceOf(sp.s);
  // The API says which address is the main one; old addresses and the permanent code move to it.
  // (On a company's own domain, "/" shows the company card without moving the visitor.)
  if (data.canonical.toLowerCase() !== code.toLowerCase() && !(host && root)) {
    redirect(`${cardHref(data.canonical, host)}${source ? `?s=${source}` : ""}`);
  }

  // Brand logos are looked up here, on the server, and drawn inline: visitors call no third party.
  const icons = resolveItemIcons(data.card.items);
  const items = data.card.items.map((it, i) => ({ ...it, res: icons[i] }));

  // The card is drawn here, on the server, so it is in the first bytes of the page and readable without scripts.
  // The client part only attaches behaviour, so the drawing engine is not sent to the browser.
  const { card } = data;
  // The card's own language wins; "auto" follows the visitor's choice or browser, and with neither it follows the card's text.
  const setting = normaliseCardLanguage(card.language);
  const guessed: Locale | null = !visitor.chosen && !visitor.browser && mostlyArabic(`${card.name} ${card.title} ${card.company}`) ? "ar" : null;
  const locale = setting === "auto" && guessed ? guessed : cardLocale(setting, visitor.locale);
  const design = normalizeDesign(card.design);
  const i18n = await getI18n(locale);
  const reportLink = i18n.t("bo.reportLink");
  // The company's pictures are measured here too (logo shape and colours, how light a background is), so the placement
  // and text colours are right in the first bytes. A company without a palette keeps the face's own colours.
  const brand = await withBrandInfo(toCompanyBrand(card.brand));
  const data2 = {
    brand,
  };
  // The bio travels with the page data for the photo headers that show it.
  const pageData: CardPageData & { bio?: string } = {
    name: card.name, title: card.title, company: card.company, address: card.address, photoUrl: card.photo_url, items,
    saveContact: card.save_contact, design, coverUrl: card.cover_url ?? null, publicUrl: card.public_url, footer: card.footer,
    customFace: card.custom_face ?? null,
    bio: card.bio ?? "",
    brand, locale,
  };
  const input = buildInput(pageData, "live");
  // The rich blocks under the card (video, products, hours, booking, team, gallery, event, map), in the owner's order.
  const sections = (
    <Sections
      sections={card.sections}
      ctx={{ t: i18n.t, locale, code: data.canonical, publicUrl: card.public_url, name: card.name, videoUrl: card.video_url ?? null, posterUrl: card.video_poster_url ?? null }}
    />
  );
  const out = drawPage(input, data2, "live");
  const hasExtras = visibleSections(card.sections, card.video_url ?? null).length > 0;
  // Without scripts the Save contact button is a plain link to the contact file; with scripts a tap opens the sheet instead.
  const html = withoutScriptTabs(input, out.html).replace(
    /<button type="button" class="sv" data-save>([\s\S]*?)<\/button>/,
    (_m, inner: string) => `<a class="sv" data-save href="${card.vcard_url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" download>${inner}</a>`,
  );
  // Layouts with tabs swap their content in the browser; the three tabs are drawn here so no engine is needed for it.
  // With extras under the card, the QR code and the "Powered by" line come after them, not before.
  const split = hasExtras ? splitTail(html) : null;
  const tabs = html.includes("data-tab=")
    ? { c: renderTab(input, "c"), s: renderTab(input, "s"), w: renderTab(input, "w") }
    : undefined;

  return (
    <div lang={locale} dir={dirOf(locale)} style={{ display: "contents" }}>
    <I18nBoundary areas={["common", "err", "card", "cardx", "content", "commerce"]} locale={locale}>
    <PublicCard
      code={data.canonical}
      source={source}
      contact={{ name: card.name, title: card.title, company: card.company, publicUrl: card.public_url, vcardUrl: card.vcard_url, photoUrl: card.photo_url }}
      pageVars={out.pageVars}
      kinds={input.items.map((i) => i.kind)}
      tabs={tabs}
      features={card.features}
      verifiedDomain={card.brand?.verified_domain ?? null}
      play={design.intro !== 0}
      sections={sections}
      after={split && split.tail ? <CardMarkup html={`<div class="pg" style="padding-top:0">${split.tail}</div>`} pageVars={out.pageVars} wrapClass={out.wrapClass} /> : null}
    >
      <CardMarkup html={split ? split.main : html} pageVars={out.pageVars} wrapClass={out.wrapClass} fullHeight />
    </PublicCard>
    </I18nBoundary>
    {/* A plain link, no script needed: the visitor reports the card on its own small page. */}
    <p style={{ textAlign: "center", fontSize: 12, padding: "10px 0 18px", margin: 0 }}>
      <a href={cardHref(data.canonical, host, "/report")} rel="nofollow" style={{ color: "inherit", opacity: 0.7 }}>{reportLink}</a>
    </p>
    </div>
  );
}
