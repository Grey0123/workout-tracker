/**
 * The figures on the Progress page (PRD 5.4). Pure, so each is tested on its own.
 * Days are local "YYYY-MM-DD" keys, as everywhere in the log.
 */
import { dateOf, keyOf, weekOf } from "../log/dates";
import { setCount, setsVolume } from "../log/sets";
import type { Entry, Exercise, Meal, SetValues } from "../log/types";
import { MEAL_SLOTS, type MealSlot } from "../log/types";

/* ------------------------------------------------------------------ periods */

export type PeriodKey = "week" | "4w" | "3m" | "6m" | "year" | "custom";
export const PERIODS: { key: PeriodKey; label: string; weeks?: number }[] = [
  { key: "week", label: "Week", weeks: 1 },
  { key: "4w", label: "4 weeks", weeks: 4 },
  { key: "3m", label: "3 months", weeks: 13 },
  { key: "6m", label: "6 months", weeks: 26 },
  { key: "year", label: "Year", weeks: 52 },
  { key: "custom", label: "Custom" },
];

export type Range = { start: string; end: string };

const addDays = (key: string, n: number) => {
  const d = dateOf(key);
  return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
export const daysBetween = (from: string, to: string) => Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / 864e5);

/** Whole weeks ending this Sunday, so "4 weeks" is the last four calendar weeks. */
export function periodRange(key: PeriodKey, today: string, custom?: Range): Range {
  if (key === "custom" && custom) return custom.start <= custom.end ? custom : { start: custom.end, end: custom.start };
  const weeks = PERIODS.find((p) => p.key === key)?.weeks ?? 4;
  const sunday = weekOf(today)[6];
  return { start: addDays(sunday, -7 * weeks + 1), end: sunday };
}

/** The same number of days, just before. */
export function previousRange(r: Range): Range {
  const days = daysBetween(r.start, r.end) + 1;
  return { start: addDays(r.start, -days), end: addDays(r.start, -1) };
}

export const inRange = (day: string, r: Range) => day >= r.start && day <= r.end;

/** Days of the range that have happened, so a week in progress isn't judged as a whole one. */
export const elapsedDays = (r: Range, today: string) => Math.max(0, daysBetween(r.start, today < r.end ? today : r.end) + 1);

/* ------------------------------------------------------------------- filter */

export type Filter = { kind: "all" } | { kind: "exercise"; id: string } | { kind: "muscle"; category: string };

export function filterEntries(entries: Entry[], byId: Map<string, Exercise>, filter: Filter): Entry[] {
  if (filter.kind === "all") return entries;
  if (filter.kind === "exercise") return entries.filter((e) => e.exercise_id === filter.id);
  return entries.filter((e) => byId.get(e.exercise_id)?.category === filter.category);
}

/* ---------------------------------------------------------------- strength */

export const epley = (w: number, r: number) => w * (1 + r / 30);

export type PrUnit = "e1rm" | "reps" | "time";
export type Pr = { exerciseId: string; date: string; set: SetValues; tempo: string | null; score: number; unit: PrUnit };

/** What a set is judged by: estimated 1RM with a weight, otherwise reps, otherwise time. */
function scoreOf(s: SetValues): { score: number; unit: PrUnit } | null {
  const w = s.weight_kg ?? 0;
  const r = s.reps ?? 0;
  if (w > 0 && r > 0) return { score: epley(w, r), unit: "e1rm" };
  if (r > 0) return { score: r, unit: "reps" };
  if ((s.duration_s ?? 0) > 0) return { score: s.duration_s!, unit: "time" };
  return null;
}

/**
 * Every personal record, oldest first: a set that beats everything before it in the
 * same unit. The first time an exercise is logged sets the mark rather than a PR.
 * Assisted exercises, cardio and sessions aren't counted (decided 2026-11-07).
 */
export function findPrs(entries: Entry[], byId: Map<string, Exercise>): Pr[] {
  const best = new Map<string, number>();
  const found = new Map<string, Pr>();   // the best PR per exercise per day
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position);
  for (const entry of sorted) {
    const exercise = byId.get(entry.exercise_id);
    if (!exercise || exercise.assisted || exercise.kind === "cardio" || exercise.kind === "session") continue;
    for (const set of entry.sets) {
      const scored = scoreOf(set);
      if (!scored) continue;
      const key = `${entry.exercise_id}:${scored.unit}`;
      const before = best.get(key);
      if (before === undefined || scored.score > before) best.set(key, scored.score);
      if (before === undefined || scored.score <= before) continue;
      const day = `${key}:${entry.date}`;
      const current = found.get(day);
      if (!current || scored.score > current.score) {
        found.set(day, { exerciseId: entry.exercise_id, date: entry.date, set, tempo: set.tempo ?? entry.tempo, score: scored.score, unit: scored.unit });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** "any" for every set, null for sets with no tempo, or one tempo. */
export type TempoFilter = "any" | null | string;

const tempoOf = (entry: Entry, s: SetValues) => s.tempo ?? entry.tempo ?? null;

/** Best estimated 1RM each day for one exercise, oldest first. */
export function e1rmByDay(entries: Entry[], exerciseId: string, tempo: TempoFilter = "any"): { date: string; value: number }[] {
  const days = new Map<string, number>();
  for (const entry of entries) {
    if (entry.exercise_id !== exerciseId) continue;
    for (const s of entry.sets) {
      if (tempo !== "any" && tempoOf(entry, s) !== tempo) continue;
      if (!(s.weight_kg && s.reps)) continue;
      days.set(entry.date, Math.max(days.get(entry.date) ?? 0, epley(s.weight_kg, s.reps)));
    }
  }
  return [...days].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

/** The tempos an exercise was logged at, for the filter. */
export function temposOf(entries: Entry[], exerciseId: string): string[] {
  const seen = new Set<string>();
  for (const e of entries) if (e.exercise_id === exerciseId) for (const s of e.sets) { const t = tempoOf(e, s); if (t) seen.add(t); }
  return [...seen].sort();
}

/** Sets by rep range: 1–5 strength, 6–12 hypertrophy, 13+ endurance. */
export function repRanges(entries: Entry[], exerciseId: string, r: Range) {
  const out = { low: 0, mid: 0, high: 0 };
  for (const e of entries) {
    if (e.exercise_id !== exerciseId || !inRange(e.date, r)) continue;
    for (const s of e.sets) {
      const reps = s.reps ?? 0;
      if (reps <= 0) continue;
      if (reps <= 5) out.low++;
      else if (reps <= 12) out.mid++;
      else out.high++;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ volume */

export const STRENGTH_GROUPS = [
  "Chest", "Back", "Shoulders", "Biceps", "Triceps", "Forearms & grip",
  "Quads", "Hamstrings", "Glutes & hips", "Calves", "Core & abs",
] as const;
export const TARGET_SETS = { low: 10, high: 20 };

const PUSH = ["Chest", "Shoulders", "Triceps"];
const PULL = ["Back", "Biceps"];
const UPPER = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Forearms & grip"];
const LOWER = ["Quads", "Hamstrings", "Glutes & hips", "Calves"];

/**
 * Sets per muscle group per week. A set counts once for the main muscle and half
 * for each other muscle the exercise works.
 */
export function muscleSets(entries: Entry[], byId: Map<string, Exercise>, r: Range, today: string) {
  const weeks = Math.max(1, elapsedDays(r, today) / 7);
  const totals = new Map<string, number>();
  const add = (group: string, n: number) => {
    if ((STRENGTH_GROUPS as readonly string[]).includes(group)) totals.set(group, (totals.get(group) ?? 0) + n);
  };
  for (const e of entries) {
    if (!inRange(e.date, r)) continue;
    const exercise = byId.get(e.exercise_id);
    if (!exercise) continue;
    const n = setCount(e.sets);
    add(exercise.category, n);
    for (const other of exercise.secondary_muscles) add(other, n / 2);
  }
  return STRENGTH_GROUPS.filter((g) => totals.has(g)).map((group) => ({ group, perWeek: Math.round((totals.get(group)! / weeks) * 10) / 10 }));
}

/** Push against pull, upper against lower, as shares of sets by main muscle. */
export function balance(entries: Entry[], byId: Map<string, Exercise>, r: Range) {
  const count = { push: 0, pull: 0, upper: 0, lower: 0 };
  for (const e of entries) {
    if (!inRange(e.date, r)) continue;
    const group = byId.get(e.exercise_id)?.category ?? "";
    const n = setCount(e.sets);
    if (PUSH.includes(group)) count.push += n;
    if (PULL.includes(group)) count.pull += n;
    if (UPPER.includes(group)) count.upper += n;
    if (LOWER.includes(group)) count.lower += n;
  }
  const share = (a: number, b: number) => (a + b ? Math.round((a / (a + b)) * 100) : null);
  return { push: share(count.push, count.pull), upper: share(count.upper, count.lower) };
}

/* ------------------------------------------------------------- consistency */

export type HeatDay = { date: string; state: "trained" | "rest" | "future" };

/** Monday-first weeks across the range, each day trained, rested or still to come. */
export function heatmap(trained: Set<string>, r: Range, today: string): { start: string; days: HeatDay[] }[] {
  const weeks: { start: string; days: HeatDay[] }[] = [];
  for (let start = weekOf(r.start)[0]; start <= r.end; start = addDays(start, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i);
      const state: HeatDay["state"] = date > today ? "future" : trained.has(date) ? "trained" : "rest";
      return { date, state };
    });
    weeks.push({ start, days });
  }
  return weeks;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Of the days someone usually trains (at least a quarter of the weeks), the one they
 * skipped most. Needs two weeks to mean anything.
 */
export function mostMissed(trained: Set<string>, r: Range, today: string) {
  const weeks = heatmap(trained, r, today).filter((w) => w.days.every((d) => d.state !== "future" && inRange(d.date, r)));
  if (weeks.length < 2) return null;
  let worst: { day: string; trained: number; weeks: number } | null = null;
  for (let i = 0; i < 7; i++) {
    const hits = weeks.filter((w) => w.days[i].state === "trained").length;
    const rate = hits / weeks.length;
    if (rate < 0.25 || rate === 1) continue;
    if (!worst || hits < worst.trained) worst = { day: WEEKDAYS[i], trained: hits, weeks: weeks.length };
  }
  return worst;
}

/* ---------------------------------------------------------------- summary */

export type Weight = { date: string; kg: number };

/** The average of the last seven days' weigh-ins for each weigh-in, so one heavy morning doesn't swing it. */
export function movingAverage(weights: Weight[], days = 7): Weight[] {
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((w) => {
    const window = sorted.filter((x) => x.date <= w.date && daysBetween(x.date, w.date) < days);
    return { date: w.date, kg: Math.round((window.reduce((s, x) => s + x.kg, 0) / window.length) * 10) / 10 };
  });
}

export function mealStats(meals: Meal[], r: Range, today: string) {
  const inside = meals.filter((m) => inRange(m.date, r) && (m.description || m.photo_path));
  const possible = elapsedDays(r, today) * 3;
  const bySlot = Object.fromEntries(MEAL_SLOTS.map((s) => [s, 0])) as Record<MealSlot, number>;
  for (const m of inside) bySlot[m.slot]++;
  const fewest = MEAL_SLOTS.reduce((a, b) => (bySlot[b] < bySlot[a] ? b : a));
  const skipped = possible / 3 - bySlot[fewest];
  return { logged: inside.length, possible, mostSkipped: skipped > 0 ? fewest : null };
}

export type Summary = {
  sessions: number;
  volume: number;
  prs: number;
  perWeek: number;
  meals: { logged: number; possible: number };
  body: { from: number; to: number } | null;
};

export function summarize(
  entries: Entry[],
  meals: Meal[],
  weights: Weight[],
  prs: Pr[],
  assisted: ReadonlySet<string>,
  r: Range,
  today: string,
): Summary {
  const inside = entries.filter((e) => inRange(e.date, r));
  const days = new Set(inside.map((e) => e.date));
  const elapsed = elapsedDays(r, today);
  const averaged = movingAverage(weights).filter((w) => inRange(w.date, r));
  const m = mealStats(meals, r, today);
  return {
    sessions: days.size,
    volume: inside.reduce((sum, e) => sum + (assisted.has(e.exercise_id) ? 0 : setsVolume(e.sets)), 0),
    prs: prs.filter((p) => inRange(p.date, r)).length,
    perWeek: elapsed ? Math.round((days.size / Math.max(1, elapsed / 7)) * 10) / 10 : 0,
    meals: { logged: m.logged, possible: m.possible },
    body: averaged.length ? { from: averaged[0].kg, to: averaged.at(-1)!.kg } : null,
  };
}

/* ------------------------------------------------------------------- goals */

export type GoalProgress = {
  start: number;
  current: number;
  target: number;
  pct: number;
  /** Change since the goal was set. */
  gain: number;
  /** When the target would be reached at the pace so far, if it's going up. */
  eta: string | null;
  reached: boolean;
};

/**
 * How far an exercise goal has come: the best estimated 1RM before the goal was set,
 * against the best of the last four weeks of logging.
 */
export function goalProgress(entries: Entry[], exerciseId: string, target: number, setOn: string, today: string): GoalProgress | null {
  const days = e1rmByDay(entries, exerciseId);
  if (!days.length) return null;
  const before = days.filter((d) => d.date <= setOn);
  const start = before.length ? before.at(-1)!.value : days[0].value;
  const lastDay = days.at(-1)!.date;
  const recent = days.filter((d) => daysBetween(d.date, lastDay) < 28);
  const current = Math.max(...recent.map((d) => d.value));
  const gain = current - start;
  const span = target - start;
  const pct = span > 0 ? Math.min(1, Math.max(0, gain / span)) : current >= target ? 1 : 0;
  const weeks = daysBetween(setOn, today) / 7;
  const reached = current >= target;
  let eta: string | null = null;
  if (!reached && gain > 0 && weeks >= 1) eta = addDays(today, Math.round(((target - current) / (gain / weeks)) * 7));
  return { start, current, target, pct, gain, eta, reached };
}

/* ------------------------------------------------------------------- recap */

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");
const short = (key: string) => dateOf(key).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * The automatic weekly or monthly summary (PRD 5.4), in plain sentences a coach can
 * start an evaluation from.
 */
export type RecapData = {
  entries: Entry[];
  meals: Meal[];
  weights: Weight[];
  prs: Pr[];
  assisted: ReadonlySet<string>;
  byId: Map<string, Exercise>;
  describeSet: (s: SetValues) => string;
};

export function recap(kind: "week" | "month", data: RecapData, today: string): { title: string; range: Range; lines: string[] } {
  const r = periodRange(kind === "week" ? "week" : "4w", today);
  const title = kind === "week" ? `Week of ${short(r.start)}` : `${short(r.start)} – ${short(r.end)}`;
  return { title, range: r, lines: recapLines(r, kind === "week" ? "the week before" : "the four weeks before", data, today) };
}

/** The same sentences for any range, compared with the same length before it. */
export function recapLines(r: Range, span: string, data: RecapData, today: string): string[] {
  const prev = previousRange(r);
  const now = summarize(data.entries, data.meals, data.weights, data.prs, data.assisted, r, today);
  const before = summarize(data.entries, data.meals, data.weights, data.prs, data.assisted, prev, today);
  const lines = [`${now.sessions} ${now.sessions === 1 ? "session" : "sessions"} (${before.sessions} ${span}).`];

  const prs = data.prs.filter((p) => inRange(p.date, r));
  lines.push(
    prs.length
      ? `${prs.length} ${prs.length === 1 ? "PR" : "PRs"}: ${prs.map((p) => `${data.byId.get(p.exerciseId)?.name ?? "an exercise"} ${data.describeSet(p.set)}`).join(", ")}.`
      : "No new PRs.",
  );
  if (now.volume || before.volume) {
    const change = before.volume ? Math.round(((now.volume - before.volume) / before.volume) * 100) : null;
    lines.push(`Volume ${fmt(now.volume)} kg${change === null ? "" : ` (${change >= 0 ? "+" : ""}${change}% on ${span})`}.`);
  }
  const trainedDays = new Set(data.entries.filter((e) => inRange(e.date, r)).map((e) => e.date)).size;
  lines.push(`Trained on ${trainedDays} of ${elapsedDays(r, today)} days.`);
  lines.push(`${now.meals.logged} of ${now.meals.possible} meals logged.`);
  if (now.body) lines.push(`Body weight ${now.body.from} → ${now.body.to} kg (7-day average).`);
  return lines;
}
