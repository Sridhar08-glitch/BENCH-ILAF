"use client";

// Charts of the staff dashboard drawn as plain SVG, to scale from zero, with the values written on them.
import { DEFAULT_PLOT, barBox, barHeight, innerSize, linePath, niceTop, ticks, xOfPoint, yOfValue, type Plot } from "@/lib/staff-admin/charts";

const COLORS = ["#3B82F6", "#FF6B35", "#10B981", "#8B5CF6", "#E11D48"];

export interface Series { name: string; values: (number | null)[]; color?: string }

export function LineChart({ series, labels, height = 220, format = (v: number) => String(Math.round(v)), label }: { series: Series[]; labels: string[]; height?: number; format?: (v: number) => string; label: string }) {
  const p: Plot = { ...DEFAULT_PLOT, height };
  const max = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const top = niceTop(max);
  const n = labels.length;
  const every = Math.max(1, Math.ceil(n / 8));
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${p.width} ${p.height}`} role="img" aria-label={label} style={{ width: "100%", height: "auto", display: "block" }}>
        {ticks(top).map((v) => (
          <g key={v}>
            <line x1={p.left} x2={p.width - p.right} y1={yOfValue(v, top, p)} y2={yOfValue(v, top, p)} stroke="var(--line)" />
            <text x={p.left - 6} y={yOfValue(v, top, p) + 4} textAnchor="end" fontSize="11" fill="var(--mute)">{format(v)}</text>
          </g>
        ))}
        {labels.map((l, i) => i % every === 0 && <text key={`${l}${i}`} x={xOfPoint(i, n, p)} y={p.height - 6} textAnchor="middle" fontSize="11" fill="var(--mute)">{l}</text>)}
        {series.map((s, si) => {
          const color = s.color ?? COLORS[si % COLORS.length];
          const last = s.values.length - 1;
          const lastValue = s.values[last];
          return (
            <g key={s.name}>
              <path d={linePath(s.values, top, p)} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {s.values.map((v, i) => v != null && <circle key={i} cx={xOfPoint(i, n, p)} cy={yOfValue(v, top, p)} r={i === last ? 4 : 2.5} fill={color}><title>{`${s.name}: ${labels[i]} ${format(v)}`}</title></circle>)}
              {lastValue != null && <text x={xOfPoint(last, n, p) - 6} y={yOfValue(lastValue, top, p) - 8} textAnchor="end" fontSize="12" fontWeight="700" fill={color}>{format(lastValue)}</text>}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <figcaption className="row" style={{ gap: 14 }}>
          {series.map((s, i) => <span key={s.name} className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: s.color ?? COLORS[i % COLORS.length], display: "inline-block" }} />{s.name}</span>)}
        </figcaption>
      )}
    </figure>
  );
}

export function BarChart({ data, height = 220, format = (v: number) => String(Math.round(v)), label, color = COLORS[0] }: { data: { label: string; value: number }[]; height?: number; format?: (v: number) => string; label: string; color?: string }) {
  const p: Plot = { ...DEFAULT_PLOT, height };
  const top = niceTop(Math.max(0, ...data.map((d) => d.value)));
  const n = data.length;
  const every = Math.max(1, Math.ceil(n / 10));
  return (
    <svg viewBox={`0 0 ${p.width} ${p.height}`} role="img" aria-label={label} style={{ width: "100%", height: "auto", display: "block" }}>
      {ticks(top).map((v) => (
        <g key={v}>
          <line x1={p.left} x2={p.width - p.right} y1={yOfValue(v, top, p)} y2={yOfValue(v, top, p)} stroke="var(--line)" />
          <text x={p.left - 6} y={yOfValue(v, top, p) + 4} textAnchor="end" fontSize="11" fill="var(--mute)">{format(v)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const box = barBox(i, n, p);
        const h = barHeight(d.value, top, p);
        const y = p.top + innerSize(p).h - h;
        return (
          <g key={`${d.label}${i}`}>
            <rect x={box.x} y={y} width={box.w} height={Math.max(h, d.value > 0 ? 1 : 0)} rx="3" fill={color}><title>{`${d.label}: ${format(d.value)}`}</title></rect>
            {n <= 14 && d.value > 0 && <text x={box.x + box.w / 2} y={y - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--ink)">{format(d.value)}</text>}
            {i % every === 0 && <text x={box.x + box.w / 2} y={p.height - 6} textAnchor="middle" fontSize="11" fill="var(--mute)">{d.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal bars with the value at the end of each: for countries and top companies. */
export function HBars({ rows, format = (v: number) => String(v), color = COLORS[1] }: { rows: { label: string; value: number }[]; format?: (v: number) => string; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "minmax(80px, 160px) 1fr auto", gap: 8, alignItems: "center" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <span style={{ background: "var(--surface-2)", borderRadius: 999, height: 10, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${(100 * r.value) / max}%`, background: color, borderRadius: 999 }} /></span>
          <b>{format(r.value)}</b>
        </div>
      ))}
      {rows.length === 0 && <span className="hint">No data yet.</span>}
    </div>
  );
}
