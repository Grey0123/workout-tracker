"use client";

import { useEffect, useMemo, useState } from "react";
import { dayMonth, dayMonthYear } from "@/lib/log/dates";
import { fmtKg, fmtTime, fmtVolume, loggedExercises, progressOf, type DayProgress, type ProgressMetric } from "@/lib/log/sets";
import { useLog } from "./log-provider";

const METRICS: { id: ProgressMetric; label: string; unit: string }[] = [
  { id: "top", label: "Top weight (kg)", unit: "kg" },
  { id: "e1rm", label: "Est. 1RM (kg)", unit: "kg" },
  { id: "volume", label: "Session volume (kg)", unit: "kg" },
  { id: "time", label: "Total time", unit: "" },
  { id: "assist", label: "Assistance (kg), less is better", unit: "kg" },
];

const fmtValue = (v: number, metric: ProgressMetric) => (metric === "time" ? fmtTime(Math.round(v)) : `${fmtKg(v)} kg`);

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

function LineChart({ days, metric }: { days: DayProgress[]; metric: ProgressMetric }) {
  const narrow = useNarrow();
  const points = days.map((d) => ({ date: d.date, value: d[metric] }));

  const W = narrow ? 380 : 920;
  const H = narrow ? 260 : 300;
  const P = narrow ? { l: 44, r: 10, t: 14, b: 34 } : { l: 56, r: 18, t: 16, b: 40 };
  const FS = narrow ? 13 : 11;
  const MAX_LABELS = narrow ? 4 : 6;

  const values = points.map((p) => p.value);
  // The best day gets the filled dot. With assistance, that's the one with the least help.
  const best = metric === "assist" ? Math.min(...values) : Math.max(...values);
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
  const axis = (v: number) => (metric === "time" ? fmtTime(Math.round(v)) : fmtKg(v));

  const step = Math.max(1, Math.ceil(points.length / MAX_LABELS));
  const labelled = points.map((_, i) => i).filter((i) => i % step === 0 || i === points.length - 1);
  const path = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pg-svg" role="img" aria-label={`Trend over ${points.length} sessions, best ${fmtValue(best, metric)}`}>
      {[0, 1, 2, 3, 4].map((g) => {
        const v = min + ((max - min) * g) / 4;
        return (
          <g key={g}>
            <line x1={P.l} y1={Y(v)} x2={W - P.r} y2={Y(v)} stroke="var(--line-soft)" strokeWidth="1" />
            <text x={P.l - 8} y={Y(v) + 4} textAnchor="end" fontSize={FS} fill="var(--muted)">
              {axis(v)}
            </text>
          </g>
        );
      })}
      <path
        className={points.length > 1 ? "pg-line" : ""}
        d={path}
        fill="none"
        stroke="var(--blue)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
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
          <title>{`${dayMonth(p.date)}: ${fmtValue(p.value, metric)}`}</title>
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

export function ProgressView() {
  const { entries, exercises, readOnly, shares, profile } = useLog();
  const logged = useMemo(() => loggedExercises(entries, exercises), [entries, exercises]);
  const [picked, setPicked] = useState("");
  const [picks, setPicks] = useState<ProgressMetric>("top");

  const exerciseId = logged.some((e) => e.id === picked) ? picked : (logged[0]?.id ?? "");
  const assisted = !!logged.find((e) => e.id === exerciseId)?.assisted;
  const days = useMemo(() => progressOf(entries, exerciseId, assisted), [entries, exerciseId, assisted]);

  // Only offer what this exercise actually has, so a plank doesn't chart 0 kg. An
  // assisted exercise charts the help it needed, never as weight lifted.
  const available = METRICS.filter((m) => {
    if (m.id === "time") return days.some((d) => d.time > 0);
    if (m.id === "assist") return assisted && days.some((d) => d.assist > 0);
    if (m.id === "e1rm") return days.some((d) => d.e1rm > 0);
    return days.some((d) => d.top > 0);
  });
  const metric = available.find((m) => m.id === picks)?.id ?? available[0]?.id ?? "top";

  if (!logged.length) {
    const empty = !readOnly
      ? "Log a workout to see your progress."
      : shares.workouts
        ? `${profile.display_name} hasn't logged a workout yet.`
        : `${profile.display_name} isn't sharing workouts with you.`;
    return <div className="card pg-empty">{empty}</div>;
  }

  const last = days.at(-1)?.date;
  const timeOnly = metric === "time";
  const helped = days.filter((d) => d.assist > 0);

  return (
    <>
      <div className="card pg-controls">
        <div className="pg-exercise-field">
          <label htmlFor="pg-exercise">Exercise</label>
          <select id="pg-exercise" value={exerciseId} onChange={(e) => setPicked(e.target.value)}>
            {logged.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="pg-metric-field">
          <label htmlFor="pg-metric">Metric</label>
          <select id="pg-metric" value={metric} onChange={(e) => setPicks(e.target.value as ProgressMetric)}>
            {available.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="stats">
        {metric === "assist" ? (
          <>
            <div className="card stat">
              <div className="num">
                {fmtKg(Math.min(...helped.map((d) => d.assist)))}
                <small> kg</small>
              </div>
              <div className="lbl">Least assistance</div>
            </div>
            <div className="card stat">
              <div className="num">
                {fmtKg(helped[0].assist)}
                <small> kg</small>
              </div>
              <div className="lbl">Started at</div>
            </div>
          </>
        ) : timeOnly ? (
          <>
            <div className="card stat">
              <div className="num">{fmtTime(Math.max(...days.map((d) => d.longest)))}</div>
              <div className="lbl">Longest set</div>
            </div>
            <div className="card stat">
              <div className="num">{fmtTime(days.reduce((sum, d) => sum + d.time, 0))}</div>
              <div className="lbl">Total time</div>
            </div>
          </>
        ) : (
          <>
            <div className="card stat">
              <div className="num">
                {fmtKg(Math.max(...days.map((d) => d.top)))}
                <small> kg</small>
              </div>
              <div className="lbl">Heaviest set</div>
            </div>
            <div className="card stat">
              <div className="num">
                {fmtKg(Math.max(...days.map((d) => d.e1rm)))}
                <small> kg</small>
              </div>
              <div className="lbl">Best est. 1RM</div>
            </div>
          </>
        )}
        <div className="card stat">
          <div className="num">{days.length}</div>
          <div className="lbl">Sessions</div>
        </div>
        <div className="card stat">
          <div className="num sm">{last ? dayMonthYear(last) : "—"}</div>
          <div className="lbl">Last trained</div>
        </div>
      </div>

      <h2 className="section">Trend</h2>
      <div className="card pg-chart-card">
        {days.length ? <LineChart days={days} metric={metric} /> : <div className="pg-empty">No sessions for this exercise yet.</div>}
      </div>
      {metric === "volume" && (
        <p className="pg-note">Total this far: {fmtVolume(days.reduce((sum, d) => sum + d.volume, 0))} kg</p>
      )}
    </>
  );
}
