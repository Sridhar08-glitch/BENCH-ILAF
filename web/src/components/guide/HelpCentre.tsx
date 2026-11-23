"use client";

// The help centre list: a search box over the titles, summaries and texts, and a filter by who the guide is for.
import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { useWs } from "@/components/app/WorkspaceContext";
import { Empty, PageHead } from "@/components/app/ui";
import { useI18n } from "@/lib/i18n/client";
import { inferAudience } from "@/lib/guide/engine";
import type { Audience } from "@/lib/guide/types";
import { START_HERE } from "@/lib/help/config";
import { AUDIENCE_LABEL } from "@/lib/help/pages";
import { search, type Searchable } from "@/lib/help/search";
import s from "./guide.module.css";


type Filter = "all" | Audience;
const FILTERS: Filter[] = ["all", "personal", "company_owner", "company_admin", "employee"];

export function HelpCentre({ articles }: { articles: Searchable[] }) {
  const { t } = useI18n();
  const { current, role } = useWs();
  const mine = inferAudience({ kind: current.kind, role }) ?? "personal";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const hits = useMemo(() => search(articles, query, filter === "all" ? null : filter).map((h) => h.item), [articles, query, filter]);
  const searching = query.trim().length > 0;
  const start = !searching && filter === "all" ? START_HERE.map((slug) => articles.find((a) => a.slug === slug)).filter((a): a is Searchable => !!a) : [];
  const rest = hits.filter((a) => !start.includes(a));
  const filterLabel = (f: Filter) => (f === "all" ? t("help.audAll") : t(AUDIENCE_LABEL[f]));

  return (
    <div className="view">
      <PageHead title={t("help.title")} sub={t("help.sub")} />
      <div className={s.hc}>
        <div className={s.hcbar}>
          <label className="search">
            <Icon name="search" size="s" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("help.searchPlaceholder")} aria-label={t("help.searchAria")} dir="auto" />
          </label>
          {searching && <button type="button" className="btn ghost sm" onClick={() => setQuery("")}>{t("help.clear")}</button>}
        </div>
        <div className={s.chips} role="group" aria-label={t("help.filterAria")}>
          {FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {filterLabel(f)}{f === mine ? ` · ${t("help.recommended")}` : ""}
            </button>
          ))}
        </div>
        <p className="hint" role="status" aria-live="polite">{t("help.results", { n: hits.length })}</p>

        {hits.length === 0 ? (
          <div className="panel"><Empty title={t("help.noResults")}>{t("help.noResultsText")}</Empty></div>
        ) : (
          <>
            {start.length > 0 && (
              <section aria-labelledby="hc-start">
                <h2 id="hc-start" style={{ fontSize: 16, marginBlockEnd: 10 }}>{t("help.startHere")}</h2>
                <div className={s.cards}>{start.map((a) => <ArticleCard key={a.slug} a={a} />)}</div>
              </section>
            )}
            <section aria-labelledby="hc-all">
              {(start.length > 0 || !searching) && <h2 id="hc-all" style={{ fontSize: 16, marginBlockEnd: 10 }}>{t("help.allGuides")}</h2>}
              <div className={s.cards}>{rest.map((a) => <ArticleCard key={a.slug} a={a} />)}</div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function ArticleCard({ a }: { a: Searchable }) {
  const { t } = useI18n();
  return (
    <Link className={s.acard} href={`/app/help/${a.slug}`}>
      <b dir="auto">{a.title}</b>
      <span dir="auto">{a.summary}</span>
      {a.audience.length > 0 && a.audience.length < 4 && (
        <span className={s.tags}>{a.audience.map((x) => <span className={s.tag} key={x}>{t(AUDIENCE_LABEL[x])}</span>)}</span>
      )}
    </Link>
  );
}
