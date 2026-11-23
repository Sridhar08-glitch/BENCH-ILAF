"use client";

// Simple SVG charts (no chart library). Series colours are the three brand dots. In a right-to-left language
// the time axis runs from right to left.
import { Icon } from "@/components/Icon";
import { useI18n } from "@/lib/i18n/client";
import type { I18n } from "@/lib/i18n";

export const COLORS = { orange: "#FF6B35", blue: "#3B82F6", green: "#10B981" };

/** Change from the previous period, as a short percentage text and a direction. */
export function delta(now: number, prev: number, i18n: Pick<I18n, "t" | "number">): { text: string; up: boolean } {
  if (prev === 0) return { text: now === 0 ? i18n.t("dash.chartNoChange") : i18n.t("dash.chartNew"), up: now >= 0 };
  const p = (now - prev) / prev;
  return { text: i18n.number(p, { style: "percent", signDisplay: "always", minimumFractionDigits: 1, maximumFractionDigits: 1 }), up: p >= 0 };
}

export function Spark({ data, color = COLORS.orange }: { data: number[]; color?: string }) {
  const { dir } = useI18n();
  const w = 120, h = 26;
  if (data.length < 2) return <div style={{ height: 26 }} />;
  const mx = Math.max(...data), mn = Math.min(...data);
  const px = (i: number) => {
    const v = (w * i) / (data.length - 1);
    return dir === "rtl" ? w - v : v;
  };
  const pts = data.map((v, i) => `${px(i).toFixed(1)} ${(h - 2 - ((h - 4) * (v - mn)) / (mx - mn || 1)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" style={{ width: "100%", height: 26, marginBlockStart: 4 }}>
      <path d={`M${pts.join(" L")}`} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

/** Line chart over days. `dates` are ISO dates, one per point. */
export function LineChart({ dates, series, label }: { dates: string[]; series: Series[]; label: string }) {
  const { t, number, dir } = useI18n();
  const rtl = dir === "rtl";
  const W = 640, H = 240, L = 40, R = 8, T = 12, B = 26;
  const mir = (v: number) => (rtl ? W - v : v);
  const pw = W - L - R, ph = H - T - B;
  const all = series.flatMap((s) => s.values);
  const mx = Math.max(1, ...all);
  const top = Math.max(4, Math.ceil(mx / 4) * 4);
  const n = dates.length;
  const x = (i: number) => mir(L + (n <= 1 ? pw / 2 : (pw * i) / (n - 1)));
  const y = (v: number) => T + ph - (ph * v) / top;
  const every = n > 40 ? 15 : n > 14 ? 7 : 1;
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {[0, 1, 2, 3, 4].map((i) => {
          const yy = T + ph - (ph * i) / 4;
          return (
            <g key={i}>
              <line x1={mir(L)} x2={mir(W - R)} y1={yy} y2={yy} stroke="rgba(0,0,0,.08)" />
              <text x={mir(L - 8)} y={yy + 4} textAnchor={rtl ? "start" : "end"} fontSize={11} fill="#8A8A8A">{number(Math.round((top * i) / 4))}</text>
            </g>
          );
        })}
        {series.map((s, si) => {
          const line = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
          return (
            <g key={s.key}>
              {si === 0 && n > 1 && <path d={`${line} L${x(n - 1).toFixed(1)} ${T + ph} L${mir(L)} ${T + ph} Z`} fill={s.color} opacity={0.1} />}
              <path d={line} fill="none" stroke={s.color} strokeWidth={si === 0 ? 2.6 : 2} strokeLinejoin="round" strokeLinecap="round" />
              {n > 0 && <circle cx={x(n - 1)} cy={y(s.values[n - 1] ?? 0)} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2.5} />}
            </g>
          );
        })}
        {dates.map((d, i) => {
          if ((i % every !== 0 || (n - 1 - i < every / 2 && i !== n - 1)) && i !== n - 1) return null;
          const b = n - 1 - i;
          return (
            <text key={d} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#8A8A8A">{b === 0 ? t("dash.chartToday") : t("dash.chartDaysAgo", { n: b })}</text>
          );
        })}
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
    </>
  );
}

/** 24 bars for the hours of the day (UTC). */
export function HoursChart({ hours }: { hours: number[] }) {
  const { t, number, dir } = useI18n();
  const rtl = dir === "rtl";
  const W = 640, H = 200, L = 30, R = 8, T = 10, B = 24;
  const pw = W - L - R, ph = H - T - B;
  const data = Array.from({ length: 24 }, (_, i) => hours[i] ?? 0);
  const mx = Math.max(1, ...data);
  const bw = pw / 24;
  // Bars are placed from the start edge: the left in English, the right in Arabic.
  const left = (i: number) => (rtl ? W - R - (i + 1) * bw : L + i * bw);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("dash.chartViewsByHour")}>
      {[0, 1, 2, 3].map((i) => {
        const yy = T + ph - (ph * i) / 3;
        return <line key={i} x1={L} x2={W - R} y1={yy} y2={yy} stroke="rgba(0,0,0,.08)" />;
      })}
      {data.map((v, i) => {
        const h = (ph * v) / mx;
        return (
          <g key={i}>
            <rect x={left(i) + 2} y={T + ph - h} width={bw - 4} height={h} rx={2} fill={v === mx && v > 0 ? COLORS.orange : "rgba(255,107,53,.25)"} />
            {i % 3 === 0 && <text x={left(i) + bw / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="#8A8A8A">{t("dash.chartHour", { n: number(i) })}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export interface BarRow {
  label: string;
  value: number;
  icon?: string;
}

/** Horizontal bars with the count at the end. */
export function Bars({ rows, empty }: { rows: BarRow[]; empty?: string }) {
  const { t, number } = useI18n();
  const total = rows.reduce((a, r) => a + r.value, 0);
  const mx = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0 || total === 0) return <p className="hint">{empty ?? t("dash.chartNoData")}</p>;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="r" key={r.label}>
          <span>{r.icon && <Icon name={r.icon} size="s" />}<span dir="auto">{r.label}</span></span>
          <div className="t"><i style={{ width: `${(r.value / mx) * 100}%` }} /></div>
          <b>{number(r.value)}</b>
        </div>
      ))}
    </div>
  );
}
