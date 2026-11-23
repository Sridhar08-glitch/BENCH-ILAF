"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { Empty, ErrorBox, PageHead, SkeletonBlocks } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import s from "@/components/ops/ops.module.css";
import { api } from "@/lib/api";
import { useAudit } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n/client";
import { ACTION_GROUPS, EMPTY_FILTERS, actorName, describeEvent, hasFilters, lastDays, queryOf, rangeProblem, whenText, type AuditFilters } from "@/lib/ops/audit";

const PAGE_SIZE = 25;

export default function ActivityPage() {
  const { current, isManager, isCompany } = useWs();
  const i18n = useI18n();
  const { t } = i18n;
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const problem = rangeProblem(filters, t);
  const query = useMemo(() => queryOf(filters, page, PAGE_SIZE), [filters, page]);
  const audit = useAudit(isManager && isCompany && !problem ? current.id : "", query);

  if (!isManager || !isCompany) {
    return (
      <div className="view">
        <PageHead title={t("company.actTitle")} sub={t("company.actSubShort")} />
        <div className="panel"><Empty title={t("company.actManagersOnly")} action={<Link className="btn sm" href="/app/cards">{t("company.goToMyCard")}</Link>} /></div>
      </div>
    );
  }

  const set = (patch: Partial<AuditFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const data = audit.data;
  const csv = api.auditCsvUrl(current.id, queryOf(filters));

  return (
    <div className="view">
      <PageHead title={t("company.actTitle")} sub={t("company.actSub")}>
        <a className="btn ghost" href={csv} download="activity.csv"><Icon name="download" size="s" />{t("company.exportCsv")}</a>
      </PageHead>

      <div className="panel card">
        <div className={s.filters}>
          <label>
            {t("company.filterWho")}
            <select value={filters.actor} onChange={(e) => set({ actor: e.target.value })}>
              <option value="">{t("company.filterEveryone")}</option>
              {(data?.actors ?? []).map((a) => <option key={a.id} value={a.id}>{a.full_name || a.email}</option>)}
            </select>
          </label>
          <label>
            {t("company.filterWhat")}
            <select value={filters.action} onChange={(e) => set({ action: e.target.value })}>
              {ACTION_GROUPS.map((g) => <option key={g.key} value={g.key}>{t(g.label)}</option>)}
            </select>
          </label>
          <label>{t("company.filterFrom")}<input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
          <label>{t("company.filterTo")}<input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></label>
          <label>
            {t("company.filterSearch")}
            <input type="search" dir="auto" value={filters.q} placeholder={t("company.filterSearchPh")} onChange={(e) => set({ q: e.target.value })} />
          </label>
        </div>
        <div className="row">
          <button type="button" className="btn ghost sm" onClick={() => set({ ...lastDays(1) })}>{t("company.today")}</button>
          <button type="button" className="btn ghost sm" onClick={() => set({ ...lastDays(7) })}>{t("company.last7")}</button>
          <button type="button" className="btn ghost sm" onClick={() => set({ ...lastDays(30) })}>{t("company.last30")}</button>
          {hasFilters(filters) && <button type="button" className="btn ghost sm" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>{t("company.clearFilters")}</button>}
        </div>
        {problem && <span className="err" role="alert">{problem}</span>}
      </div>

      <div className="panel card">
        {audit.isLoading ? <SkeletonBlocks rows={4} /> : audit.error ? <ErrorBox error={audit.error} onRetry={() => void audit.refetch()} /> : !data || data.results.length === 0 ? (
          <Empty title={hasFilters(filters) ? t("company.noMatch") : t("company.noActivity")}>
            {hasFilters(filters) ? t("company.noMatchText") : t("company.noActivityText")}
          </Empty>
        ) : (
          <div role="list" aria-label={t("company.activityAria")}>
            {data.results.map((e) => (
              <div className={s.ev} key={e.id} role="listitem">
                <time dateTime={e.created_at}>{whenText(e.created_at, i18n)}</time>
                <div className={s.what}>
                  <b dir="auto">{describeEvent(e, i18n)}</b>
                  <small>
                    <bdi>{t("company.byActor", { name: actorName(e, t) })}</bdi>
                    {e.actor?.email && e.actor.full_name ? <> (<bdi className="ltr">{e.actor.email}</bdi>)</> : null}
                  </small>
                </div>
              </div>
            ))}
          </div>
        )}
        {data && data.count > 0 && (
          <div className={s.pager}>
            <span className="hint">{t("company.pager", { n: data.count, page: data.page, pages: data.pages })}</span>
            <div className="row">
              <button type="button" className="btn ghost sm" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{t("common.previous")}</button>
              <button type="button" className="btn ghost sm" disabled={data.page >= data.pages} onClick={() => setPage((p) => p + 1)}>{t("common.next")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
