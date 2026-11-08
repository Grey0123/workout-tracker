// Routines and plans: pure helpers, shared by the calendar, Home and Progress.
// Relative imports, so the tests can load this without the app's path aliases.
import { setCount } from "../log/sets";
import type { Entry, Exercise, SetValues, Side } from "../log/types";

/** One exercise in a routine, or in a day's plan, with what it asks for. */
export type RoutineItem = {
  exercise_id: string;
  variant: string | null;
  target_sets: number | null;
  /** A number or a range, like "8" or "8-10". */
  target_reps: string | null;
  target_tempo: string | null;
  notes: string | null;
};

export type Routine = {
  id: string;
  name: string;
  notes: string | null;
  updated_at: string;
  items: RoutineItem[];
};

/** A routine put on a day: by the person themselves, or by their coach. */
export type Plan = {
  id: string;
  date: string;
  name: string;
  notes: string | null;
  template_id: string | null;
  assigned_by: string | null;
  skipped_at: string | null;
  items: RoutineItem[];
};

export type PlanStatus = "done" | "skipped" | "missed" | "planned";

export const REPS = /^\d{1,3}(-\d{1,3})?$/;

/** "8-10" as [8, 10], "8" as [8, 8]. Null when there's no target. */
export function repRange(target: string | null): [number, number] | null {
  if (!target || !REPS.test(target)) return null;
  const [lo, hi = lo] = target.split("-").map(Number);
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

/** "4 × 6–8 · 3-1-1-0", or what there is of it. */
export function targetLabel(item: RoutineItem): string {
  const bits: string[] = [];
  const reps = item.target_reps?.replace("-", "–");
  if (item.target_sets && reps) bits.push(`${item.target_sets} × ${reps}`);
  else if (item.target_sets) bits.push(`${item.target_sets} ${item.target_sets === 1 ? "set" : "sets"}`);
  else if (reps) bits.push(`${reps} reps`);
  if (item.target_tempo) bits.push(`tempo ${item.target_tempo}`);
  return bits.join(" · ");
}

const variantKey = (v: string | null) => v?.trim().toLowerCase() ?? "";

/** The last time this exercise was logged before the day: the same variant (or none) if there is one. */
export function lastEntryFor(entries: Entry[], exerciseId: string, before: string, variant: string | null = null): Entry | undefined {
  const earlier = entries
    .filter((e) => e.exercise_id === exerciseId && e.date < before && e.sets.length)
    .sort((a, b) => b.date.localeCompare(a.date) || b.position - a.position);
  return earlier.find((e) => variantKey(e.variant) === variantKey(variant)) ?? earlier[0];
}

const blank = (side: Side | null): SetValues => ({
  weight_kg: null, reps: null, duration_s: null, distance_km: null, rounds: null, rpe: null, calories: null, tempo: null, side,
});

/**
 * The sets a planned exercise starts with: as many as the plan asks for, each with
 * last session's weight (PRD 5.5: "pre-filled with last session's weights"). Reps
 * follow the plan; last session's reps stay when they're inside its range.
 */
export function plannedSets(item: RoutineItem, exercise: Exercise | undefined, entries: Entry[], day: string): SetValues[] {
  const last = lastEntryFor(entries, item.exercise_id, day, item.variant);
  const count = item.target_sets ?? (last ? setCount(last.sets) : 3);
  const range = repRange(item.target_reps);
  const sides: (Side | null)[] = exercise?.per_side ? ["left", "right"] : [null];
  const logsReps = !exercise || exercise.inputs.includes("reps");

  const out: SetValues[] = [];
  for (let i = 0; i < count; i++) {
    for (const side of sides) {
      const all = last?.sets ?? [];
      const sided = side ? all.filter((s) => s.side === side) : all;
      const previous = sided.length ? sided : all;
      const from = previous[i] ?? previous.at(-1);
      const set = blank(side);
      if (from) {
        set.weight_kg = from.weight_kg;
        set.duration_s = from.duration_s;
        set.distance_km = from.distance_km;
        set.rounds = from.rounds;
        set.reps = from.reps;
      }
      if (range && logsReps && !(set.reps !== null && set.reps >= range[0] && set.reps <= range[1])) set.reps = range[0];
      out.push(set);
    }
  }
  return out;
}

/** Done once a workout is logged that day, so it can't disagree with the log. */
export function planStatus(plan: Plan, trained: boolean, today: string): PlanStatus {
  if (trained) return "done";
  if (plan.skipped_at) return "skipped";
  return plan.date < today ? "missed" : "planned";
}

export const STATUS_LABEL: Record<PlanStatus, string> = {
  done: "Done",
  skipped: "Skipped",
  missed: "Missed",
  planned: "Planned",
};

/** Planned days in a period, and how many of them were trained ("3 of 6 planned sessions"). */
export function planCounts(plans: Plan[], trained: ReadonlySet<string>, from: string, to: string) {
  const inRange = plans.filter((p) => p.date >= from && p.date <= to);
  return { planned: inRange.length, done: inRange.filter((p) => trained.has(p.date)).length };
}

/** The next plan from today on that isn't done or skipped. */
export function nextPlan(plans: Plan[], trained: ReadonlySet<string>, today: string): Plan | undefined {
  return [...plans]
    .filter((p) => p.date >= today && !p.skipped_at && !trained.has(p.date))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}

/** A logged day as a routine: each exercise with its sets, reps and tempo ("Save this day as a routine"). */
export function routineFromDay(entries: Entry[]): RoutineItem[] {
  return [...entries]
    .sort((a, b) => a.position - b.position)
    .map((e) => {
      const reps = e.sets.map((s) => s.reps).filter((r): r is number => r !== null && r > 0);
      const lo = Math.min(...reps);
      const hi = Math.max(...reps);
      return {
        exercise_id: e.exercise_id,
        variant: e.variant,
        target_sets: Math.min(20, Math.max(1, setCount(e.sets))),
        target_reps: reps.length ? (lo === hi ? String(lo) : `${lo}-${hi}`) : null,
        target_tempo: e.tempo,
        notes: null,
      };
    });
}
