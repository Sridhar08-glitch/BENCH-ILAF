"use client";

// My support requests: status chips, unread replies, and the way to a new request.
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Empty, ErrorBox, PageHead, SkeletonBlocks } from "@/components/app/ui";
import { CATEGORY_KEYS, StatusChip } from "@/components/support/shared";
import { useI18n } from "@/lib/i18n/client";
import { supportApi } from "@/lib/support/api";

const TABS = ["open", "solved", ""] as const;

export default function SupportPage() {
  const { t, date } = useI18n();
  const [tab, setTab] = useState<(typeof TABS)[number]>("open");
  const list = useQuery({ queryKey: ["support-tickets", tab], queryFn: () => supportApi.tickets(tab || undefined), refetchInterval: 60_000 });
  const tabLabel = { open: t("support.tabOpen"), solved: t("support.tabSolved"), "": t("support.tabAll") };
  return (
    <div className="view">
      <PageHead title={t("support.title")} sub={t("support.sub")}>
        <Link className="btn" href="/app/support/new">{t("support.newRequest")}</Link>
      </PageHead>
      <div className="row" role="tablist" aria-label={t("support.title")} style={{ flexWrap: "wrap" }}>
        {TABS.map((k) => (
          <button key={k || "all"} type="button" role="tab" aria-selected={tab === k} className={`btn sm ${tab === k ? "" : "ghost"}`} onClick={() => setTab(k)}>{tabLabel[k]}</button>
        ))}
      </div>
      {list.isLoading && <SkeletonBlocks rows={3} />}
      {list.error && <ErrorBox error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && list.data.length === 0 && (
        <Empty title={t("support.emptyTitle")} action={<Link className="btn" href="/app/support/new">{t("support.newRequest")}</Link>}>{t("support.emptyText")}</Empty>
      )}
      <div className="pane">
        {(list.data ?? []).map((r) => (
          <Link key={r.id} href={`/app/support/${r.id}`} className="panel" style={{ padding: 14, display: "grid", gap: 6, textDecoration: "none" }}>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <StatusChip status={r.status} />
              {r.unread > 0 && <span className="pill bad">{t("support.unread", { n: r.unread })}</span>}
              <span className="grow" />
              <span className="hint">{r.label} · {date(r.last_message_at ?? r.created_at)}</span>
            </div>
            <b dir="auto">{r.subject}</b>
            <span className="hint">{t(CATEGORY_KEYS[r.category])}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
