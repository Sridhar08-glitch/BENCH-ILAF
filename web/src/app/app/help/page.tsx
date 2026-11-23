import type { Metadata } from "next";
import { HelpCentre } from "@/components/guide/HelpCentre";
import { plainText } from "@/lib/help/markdown";
import type { Searchable } from "@/lib/help/search";
import { getI18n } from "@/lib/i18n/server";
import { loadArticles } from "@/lib/server/help";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("help.title"), robots: { index: false, follow: false } };
}

// Read per request: the articles follow the language of the signed-in person.
export const dynamic = "force-dynamic";

export default async function HelpPage() {
  const { locale } = await getI18n();
  const articles: Searchable[] = loadArticles(locale).map((a) => ({
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    audience: a.audience,
    text: plainText(a.body),
  }));
  return <HelpCentre articles={articles} />;
}
