"use client";

// Charts drawn in SVG, to scale, with a hover read-out. No chart library. In a right-to-left language the time
// axis runs from right to left and the value scale moves to the right edge.
import { useState } from "react";
import { bucketLabel, niceMax } from "@/lib/crm/analytics";
import { useI18n } from "@/lib/i18n/client";
import s from "./crm.module.css";

export interface TimeSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

type Group = "day" | "week" | "month";

const W = 640, H = 250, L = 44, R = 10, T = 12, B = 28;
const PW = W - L - R, PH = H - T - B;

function Axes({ top }: { top: number }) {
  const { dir, number } = useI18n();
  const rtl = dir === "rtl";
  const mx = (v: number) => (rtl ? W - v : v);
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = T + PH - (PH * i) / 4;
        return (
          <g key={i}>
            <line x1={mx(L)} x2={mx(W - R)} y1={y} y2={y} stroke="rgba(0,0,0,.08)" />
            <text x={mx(L - 8)} y={y + 4} textAnchor={rtl ? "start" : "end"} fontSize={11} fill="#70757F">{number(Math.round((top * i) / 4))}</text>
          </g>
        );
      })}
    </>
  );
}

function XLabels({ dates, group, x }: { dates: string[]; group: Group; x: (i: number) => number }) {
  const { dir, date } = useI18n();
  const rtl = dir === "rtl";
  const n = dates.length;
  const step = Math.max(1, Math.ceil(n / 8));
  const first = rtl ? "end" : "start";
  const last = rtl ? "start" : "end";
  return (
    <>
      {dates.map((d, i) =>
        (i % step === 0 && (n - 1 - i >= step / 2 || i === n - 1)) || i === n - 1 ? (
          <text key={d} x={x(i)} y={H - 8} textAnchor={i === 0 ? first : i === n - 1 ? last : "middle"} fontSize={11} fill="#70757F">{bucketLabel(d, group, date)}</text>
        ) : null,
      )}
    </>
  );
}

// The read-out sits at the pointer's place on screen, so it is placed from the physical left edge.
function Tip({ index, dates, group, series, xPct }: { index: number; dates: string[]; group: Group; series: TimeSeries[]; xPct: number }) {
  const { t, number, date } = useI18n();
  const label = bucketLabel(dates[index], group, date);
  return (
    <div
      role="status"
      style={{
        position: "absolute", top: 4, left: `${Math.min(Math.max(xPct, 18), 82)}%`, transform: "translateX(-50%)", pointerEvents: "none",
        background: "#101114", color: "#fff", borderRadius: 10, padding: "8px 10px", fontSize: 12, lineHeight: 1.5, whiteSpace: "nowrap",
      }}
    >
      <b>{group === "week" ? t("analytics.weekOf", { date: label }) : label}</b>
      {series.map((x) => (
        <div key={x.key}><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: x.color, marginInlineEnd: 6 }} />{x.label}: {number(x.values[index] ?? 0)}</div>
      ))}
    </div>
  );
}

/** Lines over days, weeks or months. The vertical scale starts at zero. */
export function TimeChart({ dates, group, series, label }: { dates: string[]; group: Group; series: TimeSeries[]; label: string }) {
  const { dir } = useI18n();
  const rtl = dir === "rtl";
  const mx = (v: number) => (rtl ? W - v : v);
  const [hover, setHover] = useState<number | null>(null);
  const n = dates.length;
  const top = niceMax(Math.max(1, ...series.flatMap((x) => x.values)));
  const x = (i: number) => mx(L + (n <= 1 ? PW / 2 : (PW * i) / (n - 1)));
  const y = (v: number) => T + PH - (PH * v) / top;
  function move(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const raw = ((e.clientX - r.left) / r.width) * W;
    const px = rtl ? W - raw : raw;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / PW) * (n - 1)))));
  }
  return (
    <div>
      <div style={{ position: "relative" }} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ display: "block", width: "100%" }}>
          <Axes top={top} />
          {series.map((sr, si) => {
            const line = sr.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
            return (
              <g key={sr.key}>
                {si === 0 && n > 1 && <path d={`${line} L${x(n - 1).toFixed(1)} ${T + PH} L${mx(L)} ${T + PH} Z`} fill={sr.color} opacity={0.1} />}
                <path d={line} fill="none" stroke={sr.color} strokeWidth={si === 0 ? 2.6 : 2} strokeLinejoin="round" strokeLinecap="round" />
                {n <= 40 && sr.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={sr.color} />)}
              </g>
            );
          })}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + PH} stroke="#101114" strokeOpacity={0.25} />}
          {hover !== null && series.map((sr) => <circle key={sr.key} cx={x(hover)} cy={y(sr.values[hover] ?? 0)} r={5} fill={sr.color} stroke="#fff" strokeWidth={2} />)}
          <XLabels dates={dates} group={group} x={x} />
        </svg>
        {hover !== null && <Tip index={hover} dates={dates} group={group} series={series} xPct={(x(hover) / W) * 100} />}
      </div>
      <div className="legend">{series.map((sr) => <span key={sr.key}><i style={{ background: sr.color }} />{sr.label}</span>)}</div>
    </div>
  );
}

/** Stacked columns: each bar is one day, week or month, split by series. */
export function StackedBars({ dates, group, series, label }: { dates: string[]; group: Group; series: TimeSeries[]; label: string }) {
  const { dir } = useI18n();
  const rtl = dir === "rtl";
  const mx = (v: number) => (rtl ? W - v : v);
  const [hover, setHover] = useState<number | null>(null);
  const n = dates.length;
  const totals = dates.map((_, i) => series.reduce((a, x) => a + (x.values[i] ?? 0), 0));
  const top = niceMax(Math.max(1, ...totals));
  const slot = PW / Math.max(n, 1);
  const bw = Math.max(2, Math.min(34, slot * 0.7));
  const cx = (i: number) => mx(L + slot * i + slot / 2);
  function move(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const raw = ((e.clientX - r.left) / r.width) * W;
    const px = rtl ? W - raw : raw;
    setHover(Math.max(0, Math.min(n - 1, Math.floor((px - L) / slot))));
  }
  return (
    <div>
      <div style={{ position: "relative" }} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ display: "block", width: "100%" }}>
          <Axes top={top} />
          {dates.map((d, i) => {
            let acc = 0;
            return (
              <g key={d} opacity={hover === null || hover === i ? 1 : 0.55}>
                {series.map((sr) => {
                  const v = sr.values[i] ?? 0;
                  const h = (PH * v) / top;
                  acc += h;
                  return v > 0 ? <rect key={sr.key} x={cx(i) - bw / 2} y={T + PH - acc} width={bw} height={h} fill={sr.color} /> : null;
                })}
              </g>
            );
          })}
          <XLabels dates={dates} group={group} x={cx} />
        </svg>
        {hover !== null && <Tip index={hover} dates={dates} group={group} series={series} xPct={(cx(hover) / W) * 100} />}
      </div>
      <div className="legend">{series.map((sr) => <span key={sr.key}><i style={{ background: sr.color }} />{sr.label}</span>)}</div>
    </div>
  );
}

export interface RankItem {
  label: string;
  value: number;
  note?: string;
}

/** Horizontal bars to one shared scale (the longest bar is the largest value). */
export function RankBars({ rows, empty, color }: { rows: RankItem[]; empty?: string; color?: string }) {
  const { t, number } = useI18n();
  const mx = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0 || rows.every((r) => r.value === 0)) return <p className="hint">{empty ?? t("analytics.nothingYet")}</p>;
  return (
    <div className={s.rankList}>
      {rows.map((r) => (
        <div className={s.rank} key={r.label}>
          <span dir="auto" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>{r.label}</span>
          <span className={s.t} aria-hidden="true"><i style={{ width: `${(100 * r.value) / mx}%`, background: color }} /></span>
          <b style={{ textAlign: "end", fontVariantNumeric: "tabular-nums" }}>{number(r.value)}</b>
        </div>
      ))}
    </div>
  );
}
