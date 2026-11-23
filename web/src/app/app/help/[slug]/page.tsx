import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/app/ui";
import { HelpArticle } from "@/components/guide/HelpArticle";
import { getI18n } from "@/lib/i18n/server";
import { loadArticle } from "@/lib/server/help";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const i18n = await getI18n();
  const a = loadArticle(i18n.locale, slug);
  return { title: a ? `${a.title} - ${i18n.t("help.title")}` : i18n.t("help.title"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

export default async function HelpArticlePage({ params }: Props) {
  const { slug } = await params;
  const i18n = await getI18n();
  const article = loadArticle(i18n.locale, slug);
  if (!article) {
    return (
      <div className="view">
        <PageHead title={i18n.t("help.notFoundTitle")} sub={i18n.t("help.notFoundText")}>
          <Link className="btn" href="/app/help">{i18n.t("help.back")}</Link>
        </PageHead>
      </div>
    );
  }
  const related = article.related.map((r) => loadArticle(i18n.locale, r)).filter((a): a is NonNullable<typeof a> => !!a);
  return <HelpArticle article={article} related={related} i18n={i18n} />;
}
