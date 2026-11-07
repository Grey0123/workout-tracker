"use client";

import { useEffect, useState } from "react";
import { dayMonth } from "@/lib/log/dates";

/** A wide viewBox on a phone would shrink the axis text to nothing. */
function useNarrow() {
  const [narrow, setNarrow] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(max-width:640px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return narrow;
}

/** v1's trend chart: one point a day, with the best one filled in. */
export function LineChart({
  points,
  format,
  lowerIsBetter = false,
  label,
}: {
  points: { date: string; value: number }[];
  format: (v: number) => string;
  lowerIsBetter?: boolean;
  label: string;
}) {
  const narrow = useNarrow();
  const W = narrow ? 380 : 920;
  const H = narrow ? 260 : 300;
  const P = narrow ? { l: 44, r: 10, t: 14, b: 34 } : { l: 56, r: 18, t: 16, b: 40 };
  const FS = narrow ? 13 : 11;
  const MAX_LABELS = narrow ? 4 : 6;

  const values = points.map((p) => p.value);
  const best = lowerIsBetter ? Math.min(...values) : Math.max(...values);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min = Math.max(0, min - 5);
    max += 5;
  }
  const span = max - min;
  min = Math.max(0, min - span * 0.08);
  max += span * 0.08;

  const X = (i: number) => (points.length === 1 ? P.l + (W - P.l - P.r) / 2 : P.l + ((W - P.l - P.r) * i) / (points.length - 1));
  const Y = (v: number) => H - P.b - ((H - P.t - P.b) * (v - min)) / (max - min);
  const clampX = (x: number) => Math.min(W - P.r, Math.max(P.l, x));
  const step = Math.max(1, Math.ceil(points.length / MAX_LABELS));
  const labelled = points.map((_, i) => i).filter((i) => i % step === 0 || i === points.length - 1);
  const path = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pg-svg" role="img" aria-label={`${label}: ${points.length} sessions, best ${format(best)}`}>
      {[0, 1, 2, 3, 4].map((g) => {
        const v = min + ((max - min) * g) / 4;
        return (
          <g key={g}>
            <line x1={P.l} y1={Y(v)} x2={W - P.r} y2={Y(v)} stroke="var(--line-soft)" strokeWidth="1" />
            <text x={P.l - 8} y={Y(v) + 4} textAnchor="end" fontSize={FS} fill="var(--muted)">
              {format(v)}
            </text>
          </g>
        );
      })}
      <path className={points.length > 1 ? "pg-line" : ""} d={path} fill="none" stroke="var(--blue)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle
          key={p.date}
          cx={X(i).toFixed(1)}
          cy={Y(p.value).toFixed(1)}
          r={p.value === best ? 5 : 3.5}
          fill={p.value === best ? "var(--blue)" : "var(--surface)"}
          stroke="var(--blue)"
          strokeWidth="2"
        >
          <title>{`${dayMonth(p.date)}: ${format(p.value)}`}</title>
        </circle>
      ))}
      {labelled.map((i) => (
        // The last date ends at the edge rather than centring on it, or it would be cut off.
        <text
          key={i}
          x={clampX(X(i))}
          y={H - P.b + 20}
          textAnchor={points.length > 1 && i === points.length - 1 ? "end" : "middle"}
          fontSize={FS}
          fill="var(--muted)"
        >
          {dayMonth(points[i].date)}
        </text>
      ))}
    </svg>
  );
}

/** A small line with no axes, for body weight. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => `${((i / (values.length - 1)) * 136 + 2).toFixed(1)},${(26 - ((v - min) / span) * 22).toFixed(1)}`).join(" ");
  return (
    <svg className="sparkline" width="140" height="30" viewBox="0 0 140 30" role="img" aria-label={label}>
      <polyline points={points} fill="none" stroke="var(--navy)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
