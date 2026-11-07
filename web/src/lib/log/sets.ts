import type { Entry, Exercise, ExerciseKind, Meal, Metric, SetValues, Side, Variable } from "./types";
import { METRICS } from "./types";

export const cleanName = (s: string) => s.replace(/\s+/g, " ").trim();

/** crypto.randomUUID only exists on https and localhost, and phones test over the LAN. */
export function newId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const fmtKg = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-GB");
export const fmtVolume = (v: number) => Math.round(v).toLocaleString("en-GB");

/* ------------------------------------------------------------------- time */

/** Long efforts are thought of in minutes, short holds in seconds. */
export const timeUnit = (kind: ExerciseKind) => (kind === "cardio" || kind === "session" ? "min" : "sec");

/** Reads "1:30", or a bare number in the exercise's unit. Null if it isn't a time. */
export function parseTime(text: string, kind: ExerciseKind): number | null {
  const s = text.trim();
  const clock = s.match(/^(\d+):([0-5]\d)$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (!/^\d+$/.test(s)) return null;
  return Number(s) * (timeUnit(kind) === "min" ? 60 : 1);
}

/** What goes back in the form field, so reopening an entry reads the same as it was typed. */
export function timeInput(seconds: number, kind: ExerciseKind): string {
  const whole = timeUnit(kind) === "min" ? seconds % 60 === 0 : seconds < 60;
  if (whole) return String(timeUnit(kind) === "min" ? seconds / 60 : seconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function fmtTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------- summaries */

const isTimed = (sets: SetValues[]) => sets.length > 0 && sets.every((s) => s.duration_s && !s.reps);

/** Left and right of one set count as one set. */
export function setCount(sets: SetValues[]): number {
  const left = sets.filter((s) => s.side === "left").length;
  const right = sets.filter((s) => s.side === "right").length;
  return sets.length - left - right + Math.max(left, right);
}

/** Collapsed label: "3 × 12", "3 × 45s", or "3 × …" when the sets differ. */
export function setsSummary(sets: SetValues[]): string {
  if (!sets.length) return "";
  const n = setCount(sets);
  if (isTimed(sets)) {
    const same = sets.every((s) => s.duration_s === sets[0].duration_s);
    if (n === 1) return fmtTime(sets[0].duration_s!);
    return `${n} × ${same ? fmtTime(sets[0].duration_s!) : "…"}`;
  }
  const same = sets.every((s) => s.reps === sets[0].reps);
  return `${n} × ${same ? (sets[0].reps ?? 0) : "…"}`;
}

/** The weight range, or what stands in for one. */
export function weightSummary(sets: SetValues[], kind: ExerciseKind, assisted = false): string {
  const weights = sets.map((s) => s.weight_kg ?? 0).filter((w) => w > 0);
  if (weights.length) {
    const lo = Math.min(...weights);
    const hi = Math.max(...weights);
    const range = lo === hi ? `${fmtKg(lo)} kg` : `${fmtKg(lo)}–${fmtKg(hi)} kg`;
    return assisted ? `${range} assist` : range;
  }
  const km = sets.reduce((sum, s) => sum + (s.distance_km ?? 0), 0);
  if (km) return `${fmtKg(km)} km`;
  if (kind === "cardio" || kind === "session" || !sets.length) return "";
  return assisted ? "No assistance" : "Bodyweight";
}

export const setsVolume = (sets: SetValues[]) => sets.reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
export const topWeight = (sets: SetValues[]) => sets.reduce((max, s) => Math.max(max, s.weight_kg ?? 0), 0);
export const totalReps = (sets: SetValues[]) => sets.reduce((sum, s) => sum + (s.reps ?? 0), 0);
export const totalTime = (sets: SetValues[]) => sets.reduce((sum, s) => sum + (s.duration_s ?? 0), 0);

export const entriesSets = (entries: Entry[]) => entries.reduce((sum, e) => sum + setCount(e.sets), 0);

/** Weight lifted. A machine's assistance isn't, so assisted exercises add nothing. */
export const entriesVolume = (entries: Entry[], assisted: ReadonlySet<string> = new Set()) =>
  entries.reduce((sum, e) => sum + (assisted.has(e.exercise_id) ? 0 : setsVolume(e.sets)), 0);

/** The right-hand figures on a set row. */
export function setDetail(set: SetValues): string {
  const bits: string[] = [];
  if (set.reps) bits.push(`${set.reps} reps`);
  if (set.duration_s) bits.push(fmtTime(set.duration_s));
  if (set.distance_km) bits.push(`${fmtKg(set.distance_km)} km`);
  if (set.rounds) bits.push(`${set.rounds} rounds`);
  if (set.rpe) bits.push(`RPE ${fmtKg(set.rpe)}`);
  if (set.calories) bits.push(`${set.calories} kcal`);
  return bits.join(" · ") || "—";
}

/** "Set 2" for a plain set, "Set 2 L" for one side of a per-side set. */
export function setLabels(sets: { side: Side | null }[]): string[] {
  let n = 0;
  let open: Side | null = null;
  return sets.map((s) => {
    if (!s.side || !open || open === s.side) {
      n++;
      open = s.side;
    } else {
      open = null;
    }
    return s.side ? `Set ${n} ${s.side === "left" ? "L" : "R"}` : `Set ${n}`;
  });
}

/* --------------------------------------------------------------------- form */

export const TEMPO = /^[0-9X]-[0-9X]-[0-9X]-[0-9X]$/;

export type DraftRow = {
  key: string;
  side: Side | null;
  tempo: string;
  values: Partial<Record<Metric, string>>;
};

const LIMITS: Partial<Record<Metric, { max: number; whole?: boolean; min?: number; name: string }>> = {
  weight_kg: { max: 9999, name: "weight" },
  reps: { max: 100000, whole: true, name: "reps" },
  distance_km: { max: 9999, name: "distance" },
  rounds: { max: 100000, whole: true, name: "rounds" },
  rpe: { min: 1, max: 10, name: "RPE" },
  calories: { max: 100000, whole: true, name: "calories" },
};

/** The number columns to show: what the exercise logs, plus anything already logged. */
export function columnsFor(exercise: Exercise | undefined, sets: SetValues[] = []): Metric[] {
  const inputs: Variable[] = exercise?.inputs ?? ["weight_kg", "reps"];
  return METRICS.filter((m) => inputs.includes(m) || sets.some((s) => s[m] !== null));
}

export function setToRow(set: SetValues, kind: ExerciseKind, key: string): DraftRow {
  const values: DraftRow["values"] = {};
  for (const m of METRICS) {
    const v = set[m];
    if (v !== null) values[m] = m === "duration_s" ? timeInput(v, kind) : String(v);
  }
  return { key, side: set.side, tempo: set.tempo ?? "", values };
}

/** Turns the form's rows into sets. Empty rows are dropped; anything unreadable is an error. */
export function readRows(rows: DraftRow[], kind: ExerciseKind): { sets: SetValues[]; error?: string } {
  const sets: SetValues[] = [];
  const labels = setLabels(rows);
  for (const [i, row] of rows.entries()) {
    const set: SetValues = {
      weight_kg: null, reps: null, duration_s: null, distance_km: null, rounds: null, rpe: null, calories: null,
      tempo: null, side: row.side,
    };
    let filled = false;
    for (const m of METRICS) {
      const text = (row.values[m] ?? "").trim();
      if (!text) continue;
      if (m === "duration_s") {
        const seconds = parseTime(text, kind);
        if (seconds === null) return { sets: [], error: `${labels[i]}: write the time in ${timeUnit(kind) === "min" ? "minutes" : "seconds"} or m:ss.` };
        set.duration_s = seconds;
        filled ||= seconds > 0;
        continue;
      }
      const limit = LIMITS[m]!;
      const value = Number(text);
      if (!Number.isFinite(value) || value < (limit.min ?? 0) || value > limit.max || (limit.whole && !Number.isInteger(value))) {
        return { sets: [], error: `${labels[i]}: check the ${limit.name}.` };
      }
      set[m] = value;
      filled ||= value > 0;
    }
    if (!filled) continue;
    const tempo = row.tempo.trim().toUpperCase();
    if (tempo && !TEMPO.test(tempo)) return { sets: [], error: `${labels[i]}: write the tempo like 3-1-1-0.` };
    set.tempo = tempo || null;
    sets.push(set);
  }
  return { sets };
}

/* ------------------------------------------------------------------ meals */

export const mealHasContent = (m: Meal | undefined) => !!m && !!(m.description || m.photo_path || m.photo_preview);

/* --------------------------------------------------------------- progress */

export type ProgressMetric = "top" | "e1rm" | "volume" | "time" | "assist";

export type DayProgress = { date: string; top: number; e1rm: number; volume: number; time: number; longest: number; assist: number };

/**
 * Per-day figures for one exercise, oldest first. e1RM is Epley, as in v1. On an
 * assisted exercise the best set is the one with the least help, and nothing is lifted.
 */
export function progressOf(entries: Entry[], exerciseId: string, assisted = false): DayProgress[] {
  const days = new Map<string, DayProgress>();
  for (const entry of entries) {
    if (entry.exercise_id !== exerciseId) continue;
    const day = days.get(entry.date) ?? { date: entry.date, top: 0, e1rm: 0, volume: 0, time: 0, longest: 0, assist: 0 };
    for (const s of entry.sets) {
      const w = s.weight_kg ?? 0;
      const r = s.reps ?? 0;
      day.time += s.duration_s ?? 0;
      day.longest = Math.max(day.longest, s.duration_s ?? 0);
      if (assisted) {
        if (w > 0) day.assist = day.assist ? Math.min(day.assist, w) : w;
        continue;
      }
      day.top = Math.max(day.top, w);
      if (w > 0 && r > 0) day.e1rm = Math.max(day.e1rm, w * (1 + r / 30));
    }
    if (!assisted) day.volume += setsVolume(entry.sets);
    days.set(entry.date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Exercises the person has logged, most used first. */
export function loggedExercises(entries: Entry[], exercises: Exercise[]): Exercise[] {
  const uses = new Map<string, number>();
  for (const e of entries) uses.set(e.exercise_id, (uses.get(e.exercise_id) ?? 0) + 1);
  return exercises
    .filter((e) => uses.has(e.id))
    .sort((a, b) => uses.get(b.id)! - uses.get(a.id)! || a.name.localeCompare(b.name));
}

/** What the person has written as the variant of this exercise, newest first, then common ones. */
export function variantSuggestions(entries: Entry[], exerciseId: string | null, common: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (v: string | null) => {
    const text = v ? cleanName(v) : "";
    if (text && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      out.push(text);
    }
  };
  const mine = entries.filter((e) => e.exercise_id === exerciseId && e.variant).sort((a, b) => b.date.localeCompare(a.date));
  for (const e of mine) add(e.variant);
  for (const v of common) add(v);
  return out;
}

/** The most recently logged exercises, for the top of the picker. */
export function recentExercises(entries: Entry[], limit = 5): string[] {
  const seen = new Set<string>();
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.position - a.position);
  for (const e of sorted) {
    seen.add(e.exercise_id);
    if (seen.size === limit) break;
  }
  return [...seen];
}
