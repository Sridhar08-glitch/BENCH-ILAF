import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { APP_NAME, WEB_URL } from "@/lib/config";
import { fetchDirectory } from "@/lib/public-api";
import { getCustomHost } from "@/lib/server/custom-host";
import { cardHref, directoryHref } from "@/lib/card-address";
import { VerifiedBadge } from "@/components/card/VerifiedBadge";
import { getI18n } from "@/lib/i18n/server";
import { directoryMeta, directoryPath, directoryQuery, parsePage, resultsLine } from "@/lib/ops/directory";
import styles from "./Directory.module.css";

// The public company directory: server rendered, works without scripts (search is a plain form), no email or phone in the list.
type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string | string[]; department?: string | string[]; page?: string | string[] }>;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const { t } = await getI18n();
  const { host } = await getCustomHost();
  const data = await fetchDirectory(slug, {}, host).catch(() => null);
  if (!data) return { title: t("company.pubNotFound"), robots: { index: false } };
  const meta = directoryMeta(data.company.name, data.total, t);
  // The API says where the directory lives: the company's own domain (its root) once verified, else the Bench /d/<slug> address.
  const url = data.company.url || `${WEB_URL}${directoryPath(data.company.slug)}`;
  // Only the plain first page is for search engines; searches and later pages point back to it.
  const plain = !first(sp.q) && !first(sp.department) && parsePage(sp.page) === 1;
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: url },
    robots: plain && data.total > 0 ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url,
      siteName: APP_NAME,
      type: "website",
      images: data.company.logo_url ? [{ url: data.company.logo_url }] : undefined,
    },
    twitter: { card: "summary", title: meta.title, description: meta.description },
  };
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

export default async function DirectoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const { t, number } = await getI18n();
  const q = first(sp.q).slice(0, 80);
  const department = first(sp.department);
  const page = parsePage(sp.page);
  const { host } = await getCustomHost();
  const data = await fetchDirectory(slug, { q, department, page }, host);
  if (!data) notFound();

  const { company } = data;
  const pal = company.palette;
  const theme = {
    "--d-bg": pal?.bg ?? "#FFFFFF",
    "--d-bg2": pal?.bg2 ?? "#F6F7F9",
    "--d-fg": pal?.fg ?? "#101114",
    "--d-acc": pal?.acc ?? "#FF6B35",
    "--d-on": pal?.on ?? "#101114",
    "--d-mute": "color-mix(in srgb, var(--d-fg) 68%, var(--d-bg))",
    "--d-line": "color-mix(in srgb, var(--d-fg) 18%, var(--d-bg))",
  } as CSSProperties;
  const logo = company.logo_url ?? company.symbol_url;
  const base = directoryHref(company.slug, host);
  const hasFilter = !!q || !!department;
  const [footBefore = "", footAfter = ""] = t("company.pubFooter", { app: "\u0001" }).split("\u0001");
  const prev = page > 1 ? `${base}${directoryQuery({ q, department, page: page - 1 })}` : null;
  const next = data.page < data.pages ? `${base}${directoryQuery({ q, department, page: data.page + 1 })}` : null;

  return (
    <div className={styles.page} style={theme}>
      <main className={styles.wrap}>
        <header className={styles.head}>
          {logo && <span className={styles.logoChip}><img className={styles.logo} src={logo} alt={company.show_company_name ? "" : company.name} /></span>}
          {(!logo || company.show_company_name) && <span className={styles.name} dir="auto">{company.name}</span>}
        </header>

        {company.verified_domain && <VerifiedBadge domain={company.verified_domain} label={t("cardx.verified")} tip={t("cardx.verifiedTip", { domain: company.verified_domain })} align="start" />}

        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{t("company.pubMeet", { company: company.name })}</h1>
          <p className={styles.sub}>{t("company.pubSub")}</p>
        </div>

        <form className={styles.search} method="get" action={base} role="search">
          <label>
            <span className={styles.vh}>{t("company.pubSearchPh")}</span>
            <input type="search" name="q" dir="auto" defaultValue={q} placeholder={t("company.pubSearchPh")} autoComplete="off" maxLength={80} />
          </label>
          {data.departments.length > 0 && (
            <label style={{ flex: "0 1 220px" }}>
              <span className={styles.vh}>{t("company.department")}</span>
              <select name="department" defaultValue={department}>
                <option value="">{t("company.pubAllDepts")}</option>
                {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name} ({number(d.count)})</option>)}
              </select>
            </label>
          )}
          <button className={styles.go} type="submit">{t("company.pubSearchBtn")}</button>
        </form>

        {data.departments.length > 0 && (
          <nav className={styles.chips} aria-label={t("company.pubDeptsNav")}>
            <Link className={styles.chip} href={`${base}${directoryQuery({ q })}`} aria-current={!department}>{t("common.all")}</Link>
            {data.departments.map((d) => (
              <Link key={d.id} className={styles.chip} href={`${base}${directoryQuery({ q, department: d.id })}`} aria-current={department === d.id}>
                <bdi>{d.name}</bdi> <small>{number(d.count)}</small>
              </Link>
            ))}
          </nav>
        )}

        <p className={styles.count} role="status">{resultsLine(data.count, data.total, hasFilter, t)}</p>

        {data.results.length === 0 ? (
          <div className={styles.empty}>
            <b>{hasFilter ? t("company.pubNoMatch") : t("company.pubNoOne")}</b>
            <span>{hasFilter ? t("company.pubTryDifferent") : t("company.pubCheckBack")}</span>
            {hasFilter && <Link className={styles.pg} href={base}>{t("company.pubShowEveryone")}</Link>}
          </div>
        ) : (
          <ul className={styles.grid}>
            {data.results.map((p) => (
              <li key={p.code}>
                <Link className={styles.person} href={cardHref(p.code, host)}>
                  <span className={styles.photo} aria-hidden="true">{p.photo_url ? <img src={p.photo_url} alt="" loading="lazy" /> : initials(p.name)}</span>
                  <span className={styles.who}>
                    <b dir="auto">{p.name}</b>
                    {p.title && <span dir="auto">{p.title}</span>}
                    {p.department && <em dir="auto">{p.department}</em>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {data.pages > 1 && (
          <nav className={styles.pager} aria-label={t("company.pubPages")}>
            <Link className={styles.pg} href={prev ?? base} aria-disabled={!prev}>{t("common.previous")}</Link>
            <span className={styles.count}>{t("company.pubPageOf", { page: data.page, pages: data.pages })}</span>
            <Link className={styles.pg} href={next ?? base} aria-disabled={!next}>{t("common.next")}</Link>
          </nav>
        )}
      </main>
      <footer className={styles.foot}>
        {footBefore}<a href={WEB_URL}>{APP_NAME}</a>{footAfter}
      </footer>
    </div>
  );
}
