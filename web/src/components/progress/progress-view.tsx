"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useLog } from "@/components/log/log-provider";
import * as coach from "@/lib/coach/api";
import { fmtSet } from "@/lib/coach/changes";
import { clientStats } from "@/lib/coach/stats";
import { dayMonth, dayMonthYear, todayKey } from "@/lib/log/dates";
import { fmtKg, fmtTime, fmtVolume, loggedExercises, plural, progressOf, type DayProgress } from "@/lib/log/sets";
import type { Exercise } from "@/lib/log/types";
import { saveWeight } from "@/lib/progress/api";
import {
  balance,
  daysBetween,
  e1rmByDay,
  filterEntries,
  findPrs,
  goalProgress,
  heatmap,
  inRange,
  mealStats,
  mostMissed,
  movingAverage,
  muscleSets,
  PERIODS,
  periodRange,
  previousRange,
  repRanges,
  summarize,
  TARGET_SETS,
  temposOf,
  type Filter,
  type PeriodKey,
  type Pr,
  type Range,
  type Summary,
} from "@/lib/progress/calc";
import { EvaluationsSection } from "./evaluations";
import { LineChart, Sparkline } from "./line-chart";
import { VideosSection } from "./videos";

const shortRange = (r: Range) => `${dayMonth(r.start)} – ${dayMonth(r.end)}`;
const fmtWeightTotal = (kg: number) => (kg >= 10000 ? `${(Math.round(kg / 100) / 10).toLocaleString("en-GB")} t` : `${fmtVolume(kg)} kg`);

function delta(now: number, before: number, show: (n: number) => string): { text: string; up: boolean | null } {
  if (Math.abs(now - before) < 1e-9) return { text: "Same as before", up: null };
  return { text: `${show(Math.abs(now - before))} vs before`, up: now > before };
}

function Stat({ value, unit, label, change }: { value: string; unit?: string; label: string; change?: { text: string; up: boolean | null } }) {
  return (
    <div className="card stat">
      <div className="num">
        {value}
        {unit && <small> {unit}</small>}
      </div>
      <div className="lbl">{label}</div>
      {change && <div className={`stat-delta${change.up === true ? " up" : change.up === false ? " down" : ""}`}>{change.up === true ? "▲ " : change.up === false ? "▼ " : ""}{change.text}</div>}
    </div>
  );
}

function SummaryGrid({ now, before }: { now: Summary; before: Summary }) {
  const { shares } = useLog();
  const pct = (s: Summary) => (s.meals.possible ? Math.round((s.meals.logged / s.meals.possible) * 100) : 0);
  const volumeChange = before.volume ? Math.round(((now.volume - before.volume) / before.volume) * 100) : null;
  const bodyChange = now.body ? Math.round((now.body.to - now.body.from) * 10) / 10 : null;
  return (
    <div className="stats summary-stats">
      <Stat value={String(now.sessions)} label="Sessions" change={delta(now.sessions, before.sessions, String)} />
      <Stat
        value={fmtWeightTotal(now.volume).split(" ")[0]}
        unit={fmtWeightTotal(now.volume).split(" ")[1]}
        label="Total volume"
        change={volumeChange === null ? undefined : { text: volumeChange === 0 ? "Same as before" : `${Math.abs(volumeChange)}% vs before`, up: volumeChange === 0 ? null : volumeChange > 0 }}
      />
      <Stat value={String(now.prs)} label="PRs hit" change={delta(now.prs, before.prs, String)} />
      <Stat value={fmtKg(now.perWeek)} unit="/ wk" label="Avg sessions" change={delta(now.perWeek, before.perWeek, fmtKg)} />
      <Stat
        value={bodyChange === null ? "—" : `${bodyChange > 0 ? "+" : bodyChange < 0 ? "−" : ""}${fmtKg(Math.abs(bodyChange))}`}
        unit={bodyChange === null ? undefined : "kg"}
        label="Body weight"
        change={{ text: now.body ? `${fmtKg(now.body.from)} → ${fmtKg(now.body.to)} kg` : "No weigh-ins", up: null }}
      />
      {shares.meals ? (
        <Stat value={String(pct(now))} unit="%" label="Meals logged" change={delta(pct(now), pct(before), (n) => `${n} pts`)} />
      ) : (
        <Stat value="—" label="Meals logged" change={{ text: "Not shared", up: null }} />
      )}
    </div>
  );
}

/** The coach's goal, with a bar when it names an exercise and a target (PRD 5.4). */
function GoalCard({ entries }: { entries: ReturnType<typeof useLog>["entries"] }) {
  const { notes, isOwn, coach: mine, actorLabel, exercises } = useLog();
  const goal = coach.currentGoal(isOwn ? notes.filter((n) => n.coach_id === mine?.person.id) : notes);
  if (!goal) return null;
  const target = goal.goal_target_kg === null ? null : Number(goal.goal_target_kg);
  const today = todayKey();
  const progress = goal.goal_exercise_id && target ? goalProgress(entries, goal.goal_exercise_id, target, goal.created_at.slice(0, 10), today) : null;
  const name = exercises.find((e) => e.id === goal.goal_exercise_id)?.name;

  return (
    <section className="card goal-card" aria-label="Current goal">
      <div className="goal-head">
        <span className="field-label">Current goal · set by {actorLabel(goal.coach_id)}</span>
        {progress && (
          <span className="goal-figure">
            {fmtKg(progress.current)} / {fmtKg(progress.target)} kg
          </span>
        )}
      </div>
      <div className="coach-goal">{goal.body}</div>
      {progress && (
        <>
          <div className="goal-bar" role="img" aria-label={`Goal progress: ${fmtKg(progress.current)} of ${fmtKg(progress.target)} kilograms`}>
            <div style={{ width: `${Math.round(progress.pct * 100)}%` }} />
          </div>
          <div className="cx-hint">
            {name} estimated 1RM, {progress.gain >= 0 ? "+" : "−"}
            {fmtKg(Math.abs(progress.gain))} kg since the goal was set.{" "}
            {progress.reached
              ? "Target reached."
              : progress.eta
                ? `At this pace you reach ${fmtKg(progress.target)} kg around ${dayMonthYear(progress.eta)}.`
                : "Not enough of a trend yet to say when it'll be reached."}
          </div>
        </>
      )}
    </section>
  );
}

/** Open reminders and this week's plan, so the next thing to work on is in view. */
function CoachFocus() {
  const { notes, coach: mine } = useLog();
  if (!mine) return null;
  const fromCoach = notes.filter((n) => n.coach_id === mine.person.id);
  const open = fromCoach.filter((n) => n.kind === "reminder" && !n.done_at);
  const plan = coach.planFor(fromCoach, todayKey());
  if (!open.length && !plan) return null;
  return (
    <section className="card coach-card" aria-label="Coach focus">
      {plan && (
        <div className="coach-part">
          <div className="field-label">This week&apos;s plan</div>
          <div className="coach-plan">{plan.body}</div>
        </div>
      )}
      {open.length > 0 && (
        <div className="coach-part">
          <div className="field-label">Still to do</div>
          <ul className="focus-list">
            {open.map((n) => (
              <li key={n.id}>{n.body}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

type Metric = "e1rm" | "top" | "volume" | "time" | "assist";
const METRIC_LABELS: Record<Metric, string> = {
  e1rm: "Est. 1RM (kg)",
  top: "Top weight (kg)",
  volume: "Session volume (kg)",
  time: "Total time",
  assist: "Assistance (kg), less is better",
};

/** v1's four figures for one exercise, over the period, with assistance and holds in their own terms. */
function ExerciseStats({ days, last, assisted, timed }: { days: DayProgress[]; last?: string; assisted: boolean; timed: boolean }) {
  const helped = days.filter((d) => d.assist > 0);
  const pairs: [string, string][] = assisted
    ? [
        [helped.length ? `${fmtKg(Math.min(...helped.map((d) => d.assist)))} kg` : "—", "Least assistance"],
        [helped.length ? `${fmtKg(helped[0].assist)} kg` : "—", "Started at"],
      ]
    : timed
      ? [
          [days.length ? fmtTime(Math.max(...days.map((d) => d.longest))) : "—", "Longest set"],
          [fmtTime(days.reduce((sum, d) => sum + d.time, 0)), "Total time"],
        ]
      : [
          [days.length ? `${fmtKg(Math.max(...days.map((d) => d.top)))} kg` : "—", "Heaviest set"],
          [days.length ? `${fmtKg(Math.max(...days.map((d) => d.e1rm)))} kg` : "—", "Best est. 1RM"],
        ];
  pairs.push([String(days.length), "Sessions"], [last ? dayMonthYear(last) : "—", "Last trained"]);
  return (
    <div className="mini-stats">
      {pairs.map(([value, label]) => (
        <div key={label} className="mini-stat">
          <b>{value}</b>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
}

function StrengthSection({ entries, byId, range, prs }: { entries: ReturnType<typeof useLog>["entries"]; byId: Map<string, Exercise>; range: Range; prs: Pr[] }) {
  const { exercises } = useLog();
  const logged = useMemo(() => loggedExercises(entries, exercises), [entries, exercises]);
  const inPeriod = logged.filter((e) => entries.some((x) => x.exercise_id === e.id && inRange(x.date, range)));
  const [picked, setPicked] = useState("");
  const [metricPick, setMetricPick] = useState<Metric>("e1rm");
  const [tempo, setTempo] = useState("any");

  const exercise = logged.find((e) => e.id === picked) ?? inPeriod[0] ?? logged[0];
  if (!exercise) return <div className="card pg-empty">No workouts here yet.</div>;

  const days = progressOf(entries, exercise.id, exercise.assisted);
  const has = (m: Metric) =>
    m === "assist" ? exercise.assisted && days.some((d) => d.assist > 0)
    : exercise.assisted ? m === "time" && days.some((d) => d.time > 0)
    : m === "e1rm" ? days.some((d) => d.e1rm > 0)
    : m === "time" ? days.some((d) => d.time > 0)
    : days.some((d) => d.top > 0);
  const metrics = (Object.keys(METRIC_LABELS) as Metric[]).filter(has);
  const metric = metrics.includes(metricPick) ? metricPick : (metrics[0] ?? "e1rm");
  const tempos = temposOf(entries, exercise.id);
  const tempoFilter = metric === "e1rm" ? (tempo === "any" ? "any" : tempo === "none" ? null : tempo) : "any";

  const points = (
    metric === "e1rm"
      ? e1rmByDay(entries, exercise.id, tempoFilter)
      : days.map((d) => ({ date: d.date, value: d[metric] })).filter((p) => p.value > 0)
  ).filter((p) => inRange(p.date, range));
  const format = (v: number) => (metric === "time" ? fmtTime(Math.round(v)) : fmtKg(v));
  const reps = repRanges(entries, exercise.id, range);
  const periodPrs = prs.filter((p) => inRange(p.date, range)).reverse();

  return (
    <section className="card strength">
      <div className="pg-controls inline">
        <div className="pg-exercise-field">
          <label htmlFor="pg-exercise">Exercise</label>
          <select id="pg-exercise" value={exercise.id} onChange={(e) => setPicked(e.target.value)}>
            {logged.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="pg-metric-field">
          <label htmlFor="pg-metric">Metric</label>
          <select id="pg-metric" value={metric} onChange={(e) => setMetricPick(e.target.value as Metric)}>
            {metrics.map((m) => (
              <option key={m} value={m}>
                {METRIC_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        {metric === "e1rm" && tempos.length > 0 && (
          <div className="pg-metric-field">
            <label htmlFor="pg-tempo">Tempo</label>
            <select id="pg-tempo" value={tempo} onChange={(e) => setTempo(e.target.value)}>
              <option value="any">Any tempo</option>
              <option value="none">No tempo set</option>
              {tempos.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {metric === "e1rm" && <p className="cx-hint strength-note">Epley, best set each session. A slow tempo and a normal one aren&apos;t comparable, so you can pick one.</p>}
      <div className="pg-chart-card">
        {points.length ? (
          <LineChart points={points} format={format} lowerIsBetter={metric === "assist"} label={`${exercise.name} ${METRIC_LABELS[metric]}`} />
        ) : (
          <div className="pg-empty">No {exercise.name} sessions in this period{tempoFilter !== "any" ? " at that tempo" : ""}.</div>
        )}
      </div>
      <ExerciseStats days={days.filter((d) => inRange(d.date, range))} last={days.at(-1)?.date} assisted={exercise.assisted} timed={metric === "time"} />
      {reps.low + reps.mid + reps.high > 0 && (
        <div className="rep-ranges" aria-label="Sets by rep range">
          <div>
            <b>{reps.low}</b>
            <small>1–5 reps</small>
          </div>
          <div>
            <b>{reps.mid}</b>
            <small>6–12 reps</small>
          </div>
          <div>
            <b>{reps.high}</b>
            <small>13+ reps</small>
          </div>
        </div>
      )}
      <div className="pr-list">
        <div className="field-label">Personal records this period</div>
        {periodPrs.length ? (
          periodPrs.slice(0, 10).map((p) => (
            <div className="pr" key={`${p.exerciseId}-${p.date}-${p.unit}`}>
              <span className="pr-badge">PR</span>
              <span className="pr-name">
                <span>{byId.get(p.exerciseId)?.name}</span>
                <small>{p.tempo ? `Tempo ${p.tempo}` : "No tempo set"}</small>
              </span>
              <span className="pr-set">{fmtSet(p.set as unknown as Record<string, unknown>)}</span>
              <span className="pr-when">{dayMonth(p.date)}</span>
            </div>
          ))
        ) : (
          <p className="cx-hint">None in this period. A PR is a set that beats everything before it.</p>
        )}
      </div>
    </section>
  );
}

function VolumeSection({ entries, byId, range, today }: { entries: ReturnType<typeof useLog>["entries"]; byId: Map<string, Exercise>; range: Range; today: string }) {
  const groups = muscleSets(entries, byId, range, today);
  const split = balance(entries, byId, range);
  if (!groups.length) return <div className="card pg-empty">No strength sets in this period.</div>;
  const scale = Math.max(24, ...groups.map((g) => g.perWeek));
  const low = groups.filter((g) => g.perWeek < TARGET_SETS.low).map((g) => g.group);
  return (
    <section className="card volume" aria-label="Weekly sets per muscle group">
      <div className="volume-head">
        <span className="field-label">Sets per muscle · average a week</span>
        <span className="cx-hint">
          Shaded: {TARGET_SETS.low}–{TARGET_SETS.high} target
        </span>
      </div>
      {groups.map((g) => (
        <div className="muscle" key={g.group}>
          <span className="muscle-name">{g.group}</span>
          <span className="muscle-bar" aria-hidden="true">
            <span className="muscle-target" style={{ left: `${(TARGET_SETS.low / scale) * 100}%`, width: `${((TARGET_SETS.high - TARGET_SETS.low) / scale) * 100}%` }} />
            <span className={`muscle-fill${g.perWeek < TARGET_SETS.low ? " low" : ""}`} style={{ width: `${Math.min(100, (g.perWeek / scale) * 100)}%` }} />
          </span>
          <span className="muscle-sets">{fmtKg(g.perWeek)}</span>
        </div>
      ))}
      {(split.push !== null || split.upper !== null) && (
        <div className="balance">
          {split.push !== null && (
            <span>
              Push <b>{split.push}%</b> · Pull <b>{100 - split.push}%</b>
            </span>
          )}
          {split.upper !== null && (
            <span>
              Upper <b>{split.upper}%</b> · Lower <b>{100 - split.upper}%</b>
            </span>
          )}
        </div>
      )}
      <p className="cx-hint">
        {low.length ? `Below the target range: ${low.join(", ")}. ` : "Every trained muscle is in or above the target range. "}
        Other muscles an exercise works count as half a set.
      </p>
    </section>
  );
}

function ConsistencySection({ entries, range, today, sessions }: { entries: ReturnType<typeof useLog>["entries"]; range: Range; today: string; sessions: number }) {
  const trained = new Set(entries.map((e) => e.date));
  const weeks = heatmap(trained, range, today);
  const missed = mostMissed(trained, range, today);
  const streak = clientStats([...trained].sort().reverse(), today).streak;
  const compact = weeks.length > 13;
  return (
    <section className="card consistency" aria-label="Consistency">
      <div className={`heat${compact ? " compact" : ""}`}>
        <span />
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="heat-dow">
            {compact ? d[0] : d}
          </span>
        ))}
        {weeks.map((w, i) => (
          <div key={w.start} className="heat-row">
            <span className="heat-label">{!compact || i % 4 === 0 ? dayMonth(w.start) : ""}</span>
            {w.days.map((d) => (
              <span
                key={d.date}
                className={`heat-cell ${d.state}${inRange(d.date, range) ? "" : " outside"}`}
                title={`${dayMonth(d.date)}, ${d.state === "future" ? "to come" : d.state === "trained" ? "trained" : "rest"}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="client-stats">
        <div>
          <b>{sessions}</b>
          <small>Sessions</small>
        </div>
        <div>
          <b>{plural(streak, "week")}</b>
          <small>Streak</small>
        </div>
        <div>
          <b>{missed ? missed.day : "—"}</b>
          <small>{missed ? `Most missed · ${missed.trained} of ${missed.weeks} wks` : "Most missed"}</small>
        </div>
      </div>
    </section>
  );
}

function NutritionBody({ range, today }: { range: Range; today: string }) {
  const { meals, weights, shares, isOwn, connection, profile, update, toast } = useLog();
  const [kg, setKg] = useState("");
  const [busy, setBusy] = useState(false);
  const stats = mealStats(meals, range, today);
  const averaged = movingAverage(weights).filter((w) => inRange(w.date, range));
  const latest = averaged.at(-1);
  const change = averaged.length > 1 ? Math.round((averaged.at(-1)!.kg - averaged[0].kg) * 10) / 10 : null;
  const weightShared = isOwn || !!connection?.share_bodyweight;

  async function log(event: FormEvent) {
    event.preventDefault();
    const value = Number(kg);
    if (!(value > 0 && value < 1000)) return toast("Enter your weight in kg.", "err");
    setBusy(true);
    try {
      await saveWeight(profile.id, today, value);
      update((d) => ({ ...d, weights: [...d.weights.filter((w) => w.date !== today), { date: today, kg: value }].sort((a, b) => a.date.localeCompare(b.date)) }));
      setKg("");
      toast("Weight saved");
    } catch (err) {
      console.error(err);
      toast("Couldn't save that. Check your connection.", "err");
    }
    setBusy(false);
  }

  return (
    <div className="nb-grid">
      <section className="card nb" aria-label="Nutrition">
        <span className="field-label">Meals logged</span>
        {shares.meals ? (
          <>
            <div className="nb-num">
              {stats.logged}
              <small> / {stats.possible}</small>
            </div>
            <div className="cx-hint">{stats.mostSkipped ? <>Most skipped: <b>{stats.mostSkipped}</b></> : "No slot skipped"}</div>
          </>
        ) : (
          <div className="cx-hint">Not shared with you.</div>
        )}
      </section>
      <section className="card nb" aria-label="Body weight">
        <span className="field-label">Body weight</span>
        {!weightShared ? (
          <div className="cx-hint">Not shared with you.</div>
        ) : latest ? (
          <>
            <div className="nb-num">
              {fmtKg(latest.kg)}
              <small> kg</small>
            </div>
            <Sparkline values={averaged.map((w) => w.kg)} label={`Body weight, 7-day average, ${averaged.length} weigh-ins`} />
            <div className="cx-hint">{change === null ? "7-day average" : `${change > 0 ? "+" : change < 0 ? "−" : "±"}${fmtKg(Math.abs(change))} kg, 7-day average`}</div>
          </>
        ) : (
          <div className="cx-hint">No weigh-ins in this period.</div>
        )}
        {isOwn && (
          <form className="weigh-in" onSubmit={log}>
            <input
              aria-label="Today's weight in kg"
              type="number"
              inputMode="decimal"
              step="any"
              min={1}
              placeholder="Today, kg"
              value={kg}
              onChange={(e) => setKg(e.target.value)}
            />
            <button type="submit" className="btn sm" disabled={busy || !kg}>
              Save
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

/** PRD 5.4: are you getting stronger, are you consistent, is eating on track. */
export function ProgressView() {
  const { entries, exercises, meals, weights, assistedIds, isOwn, shares, profile } = useLog();
  const today = todayKey();
  const [period, setPeriod] = useState<PeriodKey>("4w");
  const [custom, setCustom] = useState<Range>(() => periodRange("4w", today));
  const [filterValue, setFilterValue] = useState("all");

  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const filter: Filter = filterValue.startsWith("ex:")
    ? { kind: "exercise", id: filterValue.slice(3) }
    : filterValue.startsWith("group:")
      ? { kind: "muscle", category: filterValue.slice(6) }
      : { kind: "all" };
  const filtered = useMemo(() => filterEntries(entries, byId, filter), [entries, byId, filterValue]); // eslint-disable-line react-hooks/exhaustive-deps
  const prs = useMemo(() => findPrs(filtered, byId), [filtered, byId]);
  const range = periodRange(period, today, custom);
  const prev = previousRange(range);
  const now = summarize(filtered, meals, weights, prs, assistedIds, range, today);
  const before = summarize(filtered, meals, weights, prs, assistedIds, prev, today);
  const logged = useMemo(() => loggedExercises(entries, exercises), [entries, exercises]);
  const groups = [...new Set(logged.map((e) => e.category))];

  if (!entries.length && !meals.length && !weights.length) {
    const empty = isOwn
      ? "Log a workout to see your progress."
      : shares.workouts
        ? `${profile.display_name} hasn't logged a workout yet.`
        : `${profile.display_name} isn't sharing workouts with you.`;
    return <div className="card pg-empty">{empty}</div>;
  }

  const periodLabel = period === "custom" ? "the same length before" : `previous ${PERIODS.find((p) => p.key === period)!.label.toLowerCase()}`;

  return (
    <>
      <section className="card period-card" aria-label="Period">
        <div className="period-chips" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" className={period === p.key ? "active" : ""} aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="custom-range">
            <label>
              From
              <input type="date" value={custom.start} max={today} onChange={(e) => e.target.value && setCustom({ ...custom, start: e.target.value })} />
            </label>
            <label>
              To
              <input type="date" value={custom.end} onChange={(e) => e.target.value && setCustom({ ...custom, end: e.target.value })} />
            </label>
          </div>
        )}
        <div className="period-meta">
          <span>
            {shortRange(range)} · vs {periodLabel}
            {daysBetween(range.start, range.end) > 400 ? " (long periods are slow to compare)" : ""}
          </span>
          <label className="filter-field">
            <span className="sr-only">Filter by exercise or muscle group</span>
            <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)} aria-label="Filter by exercise or muscle group">
              <option value="all">Everything</option>
              <optgroup label="Muscle groups">
                {groups.map((g) => (
                  <option key={g} value={`group:${g}`}>
                    {g}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Exercises">
                {logged.map((e) => (
                  <option key={e.id} value={`ex:${e.id}`}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        </div>
      </section>

      <SummaryGrid now={now} before={before} />
      <GoalCard entries={entries} />
      {isOwn && <CoachFocus />}

      <h2 className="section">Strength</h2>
      <StrengthSection entries={filtered} byId={byId} range={range} prs={prs} />

      <h2 className="section">Volume</h2>
      <VolumeSection entries={filtered} byId={byId} range={range} today={today} />

      <h2 className="section">Consistency</h2>
      <ConsistencySection entries={filtered} range={range} today={today} sessions={now.sessions} />

      <h2 className="section">Nutrition &amp; body</h2>
      <NutritionBody range={range} today={today} />

      <VideosSection range={range} filter={filter} byId={byId} />

      <EvaluationsSection range={range} prs={prs} />
    </>
  );
}
