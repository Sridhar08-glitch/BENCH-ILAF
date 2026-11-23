"use client";

// Support metrics, computed by the server with database aggregates: reply and resolution times, volume, satisfaction, chats.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorBox, SkeletonBlocks } from "@/components/app/ui";
import { SupportTabs } from "@/components/staff-support/parts";
import { staffSupportApi } from "@/lib/support/api";
import { formatDuration } from "@/lib/support/format";
import { ST } from "@/lib/support/staff-text";
import type { Category } from "@/lib/support/types";

const RANGES = [7, 30, 90] as const;

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="hint">{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function Bars({ rows, label }: { rows: { name: string; count: number }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="panel pane" style={{ padding: 14 }} role="group" aria-label={label}>
      <h2>{label}</h2>
      {rows.length === 0 && <span className="hint">{ST.none}</span>}
      {rows.map((r) => (
        <div key={r.name} style={{ display: "grid", gridTemplateColumns: "150px 1fr 40px", gap: 8, alignItems: "center" }}>
          <span>{r.name}</span>
          <div style={{ background: "var(--surface-2)", borderRadius: 999, height: 10 }}><div style={{ width: `${(r.count / max) * 100}%`, background: "var(--accent)", height: 10, borderRadius: 999 }} /></div>
          <b>{r.count}</b>
        </div>
      ))}
    </div>
  );
}

export default function MetricsPage() {
  const [days, setDays] = useState<number>(30);
  const q = useQuery({ queryKey: ["staff-support-metrics", days], queryFn: () => staffSupportApi.metrics(days), placeholderData: (p) => p });
  const m = q.data;
  const maxDay = Math.max(1, ...(m?.by_day ?? []).map((d) => d.count));
  return (
    <div className="view">
      <h1>{ST.metricsTitle}</h1>
      <SupportTabs />
      <div className="row" role="group" aria-label={ST.metricsTitle}>
        {RANGES.map((n) => <button key={n} type="button" aria-pressed={days === n} className={`btn sm ${days === n ? "" : "ghost"}`} onClick={() => setDays(n)}>{ST.lastDays(n)}</button>)}
      </div>
      {q.isLoading && <SkeletonBlocks rows={3} />}
      {q.error && !m && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {m && (
        <>
          <div className="g3" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            <Tile label={ST.mCreated} value={m.created} />
            <Tile label={ST.mSolved} value={m.solved} />
            <Tile label={ST.mOpen} value={m.open_now} />
            <Tile label={ST.mBreached} value={m.breached_now} />
            <Tile label={ST.mFirst} value={formatDuration(m.first_response_seconds)} />
            <Tile label={ST.mResolution} value={formatDuration(m.resolution_seconds)} />
          </div>
          <div className="panel pane" style={{ padding: 14 }}>
            <h2>{ST.mByDay}</h2>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 100 }} role="img" aria-label={ST.mByDay}>
              {m.by_day.map((d) => <div key={d.date} title={`${d.date}: ${d.count}`} style={{ flex: 1, background: "var(--accent)", height: `${Math.max(2, (d.count / maxDay) * 100)}%`, borderRadius: 3 }} />)}
            </div>
          </div>
          <div className="g2" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            <Bars label={ST.mByCategory} rows={m.by_category.map((r) => ({ name: ST.categories[r.category as Category] ?? r.category, count: r.count }))} />
            <Bars label={ST.mByChannel} rows={m.by_channel.map((r) => ({ name: ST.channels[r.channel as keyof typeof ST.channels] ?? r.channel, count: r.count }))} />
            <div className="panel pane" style={{ padding: 14 }}>
              <h2>{ST.mSatisfaction}</h2>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{m.satisfaction.average ? m.satisfaction.average.toFixed(1) : "-"} / 5</div>
              <span className="hint">{ST.mRatings(m.satisfaction.count)}</span>
              <Bars label={ST.mSatisfaction} rows={Object.entries(m.satisfaction.distribution).map(([k, v]) => ({ name: `${k} / 5`, count: v }))} />
            </div>
            <div className="panel pane" style={{ padding: 14 }}>
              <h2>{ST.mChats}</h2>
              <Bars label={ST.mChats} rows={[{ name: ST.mChatsTotal, count: m.chats.total }, { name: ST.mAnswered, count: m.chats.answered }, { name: ST.mConverted, count: m.chats.converted }]} />
              <span className="hint">{ST.mWait}: {formatDuration(m.chats.wait_seconds)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
