import { describe, expect, it } from "vitest";
import {
  lastEntryFor,
  nextPlan,
  planCounts,
  plannedSets,
  planStatus,
  repRange,
  routineFromDay,
  targetLabel,
  type Plan,
  type RoutineItem,
} from "../src/lib/routines/plan";
import type { Entry, Exercise, SetValues } from "../src/lib/log/types";

const set = (weight_kg: number | null, reps: number | null, extra: Partial<SetValues> = {}): SetValues => ({
  weight_kg, reps, duration_s: null, distance_km: null, rounds: null, rpe: null, calories: null, tempo: null, side: null, ...extra,
});
let seq = 0;
const entry = (date: string, exercise_id: string, sets: SetValues[], extra: Partial<Entry> = {}): Entry => ({
  id: `e${++seq}`, date, exercise_id, position: seq, variant: null, notes: null, tempo: null, sets, ...extra,
});
const ex = (id: string, extra: Partial<Exercise> = {}): Exercise => ({
  id, name: id, category: "Chest", secondary_muscles: [], equipment: null, kind: "weighted", inputs: ["weight_kg", "reps"],
  per_side: false, assisted: false, is_custom: false, created_by: null, ...extra,
});
const item = (exercise_id: string, extra: Partial<RoutineItem> = {}): RoutineItem => ({
  exercise_id, variant: null, target_sets: null, target_reps: null, target_tempo: null, notes: null, ...extra,
});
const plan = (date: string, extra: Partial<Plan> = {}): Plan => ({
  id: date, date, name: "Push", notes: null, template_id: null, assigned_by: null, skipped_at: null, items: [], ...extra,
});
const values = (sets: SetValues[]) => sets.map((s) => [s.weight_kg, s.reps]);

describe("targets", () => {
  it("read reps as a range", () => {
    expect(repRange("8-10")).toEqual([8, 10]);
    expect(repRange("12")).toEqual([12, 12]);
    expect(repRange("10-8")).toEqual([8, 10]);
    expect(repRange(null)).toBeNull();
    expect(repRange("many")).toBeNull();
  });

  it("are labelled with what there is", () => {
    expect(targetLabel(item("b", { target_sets: 4, target_reps: "6-8", target_tempo: "3-1-1-0" }))).toBe("4 × 6–8 · tempo 3-1-1-0");
    expect(targetLabel(item("b", { target_sets: 1 }))).toBe("1 set");
    expect(targetLabel(item("b", { target_reps: "10" }))).toBe("10 reps");
    expect(targetLabel(item("b"))).toBe("");
  });
});

describe("planned sets", () => {
  const bench = ex("bench");
  const log = [
    entry("2026-11-01", "bench", [set(60, 8), set(65, 6)]),
    entry("2026-11-04", "bench", [set(70, 8), set(72.5, 7), set(75, 5)]),
    entry("2026-11-04", "bench", [set(30, 12)], { variant: "Dumbbell" }),
    entry("2026-11-09", "bench", [set(99, 1)]),
  ];

  it("take last session's weights, before the day only", () => {
    expect(lastEntryFor(log, "bench", "2026-11-09")?.date).toBe("2026-11-04");
    expect(values(plannedSets(item("bench"), bench, log, "2026-11-09"))).toEqual([[70, 8], [72.5, 7], [75, 5]]);
  });

  it("prefer the same variant", () => {
    expect(values(plannedSets(item("bench", { variant: "dumbbell" }), bench, log, "2026-11-09"))).toEqual([[30, 12]]);
  });

  it("follow the plan's set count, repeating the last set's weight", () => {
    expect(values(plannedSets(item("bench", { target_sets: 4 }), bench, log, "2026-11-02"))).toEqual([[60, 8], [65, 6], [65, 6], [65, 6]]);
  });

  it("keep last reps inside the target range, and use its low end otherwise", () => {
    const sets = plannedSets(item("bench", { target_sets: 3, target_reps: "6-8" }), bench, log, "2026-11-09");
    expect(values(sets)).toEqual([[70, 8], [72.5, 7], [75, 6]]);
  });

  it("start blank, three sets, for an exercise never logged", () => {
    expect(values(plannedSets(item("squat"), ex("squat"), log, "2026-11-09"))).toEqual([[null, null], [null, null], [null, null]]);
    expect(values(plannedSets(item("squat", { target_sets: 2, target_reps: "5" }), ex("squat"), log, "2026-11-09"))).toEqual([[null, 5], [null, 5]]);
  });

  it("give each side its own row on a per-side exercise", () => {
    const lunge = ex("lunge", { per_side: true });
    const done = [entry("2026-11-01", "lunge", [set(20, 10, { side: "left" }), set(22, 9, { side: "right" })])];
    const sets = plannedSets(item("lunge", { target_sets: 2 }), lunge, done, "2026-11-08");
    expect(sets.map((s) => [s.side, s.weight_kg, s.reps])).toEqual([
      ["left", 20, 10], ["right", 22, 9], ["left", 20, 10], ["right", 22, 9],
    ]);
  });

  it("carry time for a hold, and add no reps to it", () => {
    const plank = ex("plank", { kind: "timed", inputs: ["weight_kg", "duration_s"] });
    const done = [entry("2026-11-01", "plank", [set(null, null, { duration_s: 45 })])];
    const sets = plannedSets(item("plank", { target_sets: 2, target_reps: "10" }), plank, done, "2026-11-08");
    expect(sets.map((s) => [s.duration_s, s.reps])).toEqual([[45, null], [45, null]]);
  });
});

describe("plan status", () => {
  it("is done when the day was trained, whatever else", () => {
    expect(planStatus(plan("2026-11-01", { skipped_at: "x" }), true, "2026-11-08")).toBe("done");
    expect(planStatus(plan("2026-11-01", { skipped_at: "x" }), false, "2026-11-08")).toBe("skipped");
    expect(planStatus(plan("2026-11-01"), false, "2026-11-08")).toBe("missed");
    expect(planStatus(plan("2026-11-08"), false, "2026-11-08")).toBe("planned");
  });

  it("counts planned days done in a period", () => {
    const plans = [plan("2026-11-02"), plan("2026-11-04"), plan("2026-11-06"), plan("2026-11-12")];
    expect(planCounts(plans, new Set(["2026-11-02", "2026-11-06", "2026-11-07"]), "2026-11-01", "2026-11-08")).toEqual({ planned: 3, done: 2 });
  });

  it("finds the next plan still to do", () => {
    const plans = [plan("2026-11-12"), plan("2026-11-08"), plan("2026-11-09", { skipped_at: "x" }), plan("2026-11-05")];
    expect(nextPlan(plans, new Set(["2026-11-08"]), "2026-11-08")?.date).toBe("2026-11-12");
    expect(nextPlan(plans, new Set(), "2026-11-08")?.date).toBe("2026-11-08");
  });
});

describe("a day as a routine", () => {
  it("keeps the order, set counts, rep ranges and tempo", () => {
    const day = [
      entry("2026-11-04", "squat", [set(100, 5), set(100, 5)], { position: 1 }),
      entry("2026-11-04", "bench", [set(70, 8), set(72.5, 6), set(75, 6)], { position: 0, tempo: "3-1-1-0", variant: "Paused" }),
      entry("2026-11-04", "run", [set(null, null, { duration_s: 1200 })], { position: 2 }),
    ];
    expect(routineFromDay(day)).toEqual([
      item("bench", { variant: "Paused", target_sets: 3, target_reps: "6-8", target_tempo: "3-1-1-0" }),
      item("squat", { target_sets: 2, target_reps: "5" }),
      item("run", { target_sets: 1 }),
    ]);
  });
});
