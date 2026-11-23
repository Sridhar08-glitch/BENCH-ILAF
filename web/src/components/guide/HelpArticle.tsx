import Link from "next/link";
import type { ReactNode } from "react";
import { PageHead } from "@/components/app/ui";
import { APP_NAME } from "@/lib/config";
import type { I18n } from "@/lib/i18n";
import type { Article } from "@/lib/help/article";
import { fillApp, parseHelp, type HelpBlock } from "@/lib/help/markdown";
import { AUDIENCE_LABEL, PAGE_NAMES } from "@/lib/help/pages";
import type { Inline } from "@/lib/legal/markdown";
import { HelpFeedback } from "./HelpFeedback";
import s from "./guide.module.css";

function inline(items: Inline[]): ReactNode[] {
  return items.map((i, n) =>
    i.kind === "bold" ? <strong key={n}>{i.text}</strong>
    : i.kind === "link" ? (i.href.startsWith("/") ? <Link key={n} href={i.href}>{i.text}</Link> : <a key={n} href={i.href} rel="noopener noreferrer">{i.text}</a>)
    : <span key={n}>{i.text}</span>,
  );
}

function blocks(list: HelpBlock[]): ReactNode[] {
  return list.map((b, n) => {
    if (b.kind === "h2") return <h2 key={n} id={b.id}>{inline(b.inline)}</h2>;
    if (b.kind === "h3") return <h3 key={n} id={b.id}>{inline(b.inline)}</h3>;
    if (b.kind === "ul") return <ul key={n}>{b.items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ul>;
    if (b.kind === "ol") return <ol key={n}>{b.items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ol>;
    if (b.kind === "tip") return <p key={n} className={s.tip} role="note">{inline(b.inline)}</p>;
    return <p key={n}>{inline(b.inline)}</p>;
  });
}

/** One help article: title, the text, "Open this page" links, related guides and the helpful thumbs. */
export function HelpArticle({ article, related, i18n }: { article: Article; related: Article[]; i18n: I18n }) {
  const { t, date } = i18n;
  const parsed = parseHelp(fillApp(article.body, APP_NAME));
  const toc = parsed.filter((b): b is Extract<HelpBlock, { kind: "h2" }> => b.kind === "h2");
  return (
    <div className="view">
      <PageHead title={article.title} sub={article.summary}>
        <Link className="btn ghost" href="/app/help">{t("help.back")}</Link>
      </PageHead>
      <article className={`panel card ${s.article}`} lang={i18n.locale} dir={i18n.dir}>
        <div className={s.tags}>
          {article.audience.length > 0 && article.audience.length < 4 && article.audience.map((a) => <span className={s.tag} key={a}>{t(AUDIENCE_LABEL[a])}</span>)}
          {article.updated && <span className={s.tag}>{t("help.updated", { date: date(article.updated, { day: "numeric", month: "long", year: "numeric" }) })}</span>}
        </div>
        {toc.length > 2 && (
          <nav className={s.toc} aria-label={t("help.onThisPage")}>
            {toc.map((h) => <a key={h.id} href={`#${h.id}`}>{h.inline.map((i) => i.text).join("")}</a>)}
          </nav>
        )}
        {blocks(parsed)}
        {article.pages.length > 0 && (
          <div className="row" role="group" aria-label={t("help.pagesHead")}>
            {article.pages.map((p) => (
              <Link key={p} className="btn" href={p}>{t("help.openNamed", { page: PAGE_NAMES[p] ? t(PAGE_NAMES[p]) : t("help.pageUnnamed") })}</Link>
            ))}
          </div>
        )}
        {related.length > 0 && (
          <section aria-labelledby="rel">
            <h2 id="rel">{t("help.relatedHead")}</h2>
            <ul>{related.map((r) => <li key={r.slug}><Link href={`/app/help/${r.slug}`}>{r.title}</Link></li>)}</ul>
          </section>
        )}
      </article>
      <HelpFeedback slug={article.slug} />
    </div>
  );
}
