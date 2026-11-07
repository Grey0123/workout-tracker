import { describe, expect, it } from "vitest";
import {
  balance,
  e1rmByDay,
  elapsedDays,
  findPrs,
  goalProgress,
  heatmap,
  mealStats,
  mostMissed,
  movingAverage,
  muscleSets,
  periodRange,
  previousRange,
  recap,
  repRanges,
  summarize,
  temposOf,
} from "../src/lib/progress/calc";
import type { Entry, Exercise, Meal, SetValues } from "../src/lib/log/types";

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
const byId = new Map([
  ["bench", ex("bench", { secondary_muscles: ["Triceps", "Shoulders"] })],
  ["row", ex("row", { category: "Back", secondary_muscles: ["Biceps"] })],
  ["squat", ex("squat", { category: "Quads" })],
  ["assist", ex("assist", { category: "Back", assisted: true })],
  ["plank", ex("plank", { category: "Core & abs", kind: "timed" })],
  ["run", ex("run", { category: "Cardio", kind: "cardio" })],
]);

// Sunday 1 November 2026.
const today = "2026-11-01";

describe("periods", () => {
  it("ends on this Sunday and counts whole weeks back", () => {
    expect(periodRange("4w", today)).toEqual({ start: "2026-10-05", end: "2026-11-01" });
    expect(periodRange("week", "2026-10-28")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(periodRange("custom", today, { start: "2026-10-10", end: "2026-10-01" })).toEqual({ start: "2026-10-01", end: "2026-10-10" });
  });

  it("compares with the same length just before", () => {
    expect(previousRange({ start: "2026-10-05", end: "2026-11-01" })).toEqual({ start: "2026-09-07", end: "2026-10-04" });
  });

  it("only counts days that have happened", () => {
    expect(elapsedDays({ start: "2026-10-26", end: "2026-11-01" }, "2026-10-28")).toBe(3);
    expect(elapsedDays({ start: "2026-10-26", end: "2026-11-01" }, "2026-12-01")).toBe(7);
  });
});

describe("personal records", () => {
  it("are sets that beat everything before, and the first time isn't one", () => {
    const prs = findPrs(
      [
        entry("2026-10-01", "bench", [set(60, 8)]),
        entry("2026-10-05", "bench", [set(60, 8), set(62.5, 8)]),
        entry("2026-10-08", "bench", [set(60, 5)]),
        entry("2026-10-12", "bench", [set(65, 8, { tempo: "3-1-1-0" }), set(67.5, 6)]),
      ],
      byId,
    );
    expect(prs.map((p) => [p.date, p.set.weight_kg])).toEqual([["2026-10-05", 62.5], ["2026-10-12", 65]]);
    expect(prs[1].tempo).toBe("3-1-1-0");
  });

  it("judge bodyweight work by reps and holds by time, and leave out assisted and cardio", () => {
    const prs = findPrs(
      [
        entry("2026-10-01", "plank", [set(null, null, { duration_s: 30 })]),
        entry("2026-10-02", "plank", [set(null, null, { duration_s: 45 })]),
        entry("2026-10-01", "assist", [set(50, 8)]),
        entry("2026-10-02", "assist", [set(40, 8)]),
        entry("2026-10-01", "run", [set(null, null, { duration_s: 600 })]),
        entry("2026-10-02", "run", [set(null, null, { duration_s: 900 })]),
      ],
      byId,
    );
    expect(prs.map((p) => [p.exerciseId, p.unit, p.score])).toEqual([["plank", "time", 45]]);
  });

  it("take the entry's tempo when a set has none", () => {
    const prs = findPrs([entry("2026-10-01", "bench", [set(60, 8)]), entry("2026-10-02", "bench", [set(70, 8)], { tempo: "2-0-X-0" })], byId);
    expect(prs[0].tempo).toBe("2-0-X-0");
  });
});

describe("strength", () => {
  const log = [
    entry("2026-10-01", "bench", [set(60, 10), set(70, 5, { tempo: "3-1-1-0" })]),
    entry("2026-10-08", "bench", [set(72.5, 3)], { tempo: "3-1-1-0" }),
  ];

  it("charts the best estimated 1RM each day, optionally at one tempo", () => {
    expect(e1rmByDay(log, "bench").map((d) => Math.round(d.value * 10) / 10)).toEqual([81.7, 79.8]);
    expect(e1rmByDay(log, "bench", "3-1-1-0").map((d) => d.date)).toEqual(["2026-10-01", "2026-10-08"]);
    expect(e1rmByDay(log, "bench", null).map((d) => d.date)).toEqual(["2026-10-01"]);
    expect(temposOf(log, "bench")).toEqual(["3-1-1-0"]);
  });

  it("sorts sets into rep ranges", () => {
    expect(repRanges(log, "bench", { start: "2026-10-01", end: "2026-10-31" })).toEqual({ low: 2, mid: 1, high: 0 });
  });
});

describe("volume", () => {
  const log = [
    entry("2026-10-26", "bench", [set(60, 8), set(60, 8)]),
    entry("2026-10-27", "row", [set(50, 10), set(50, 10)]),
    entry("2026-10-28", "squat", [set(80, 5)]),
    entry("2026-10-28", "run", [set(null, null, { duration_s: 600 })]),
  ];
  const week = { start: "2026-10-26", end: "2026-11-01" };

  it("counts a set once for the main muscle and half for the others", () => {
    expect(muscleSets(log, byId, week, today)).toEqual([
      { group: "Chest", perWeek: 2 },
      { group: "Back", perWeek: 2 },
      { group: "Shoulders", perWeek: 1 },
      { group: "Biceps", perWeek: 1 },
      { group: "Triceps", perWeek: 1 },
      { group: "Quads", perWeek: 1 },
    ]);
  });

  it("averages over the weeks that have passed", () => {
    expect(muscleSets(log, byId, { start: "2026-10-19", end: "2026-11-01" }, today)[0]).toEqual({ group: "Chest", perWeek: 1 });
  });

  it("shares push against pull and upper against lower", () => {
    expect(balance(log, byId, week)).toEqual({ push: 50, upper: 80 });
    expect(balance([], byId, week)).toEqual({ push: null, upper: null });
  });
});

describe("consistency", () => {
  const trained = new Set(["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-19", "2026-10-21", "2026-10-26", "2026-10-28"]);

  it("lays out weeks of trained, rest and future days", () => {
    const weeks = heatmap(trained, { start: "2026-10-26", end: "2026-11-01" }, "2026-10-28");
    expect(weeks).toHaveLength(1);
    expect(weeks[0].days.map((d) => d.state)).toEqual(["trained", "rest", "trained", "future", "future", "future", "future"]);
  });

  it("finds the usual training day that was skipped most", () => {
    // Mondays every week, Wednesdays three weeks out of four.
    expect(mostMissed(trained, { start: "2026-10-05", end: "2026-11-01" }, today)).toEqual({ day: "Wed", trained: 3, weeks: 4 });
    expect(mostMissed(trained, { start: "2026-10-26", end: "2026-11-01" }, today)).toBeNull();
  });
});

describe("summary, meals and body weight", () => {
  const meal = (date: string, slot: Meal["slot"]): Meal => ({ id: `${date}${slot}`, date, slot, description: "x", notes: null, photo_path: null });

  it("counts meals against three a day, and names the slot skipped most", () => {
    const week = { start: "2026-10-26", end: "2026-11-01" };
    const meals = [meal("2026-10-26", "morning"), meal("2026-10-26", "evening"), meal("2026-10-27", "morning")];
    expect(mealStats(meals, week, "2026-10-27")).toEqual({ logged: 3, possible: 6, mostSkipped: "afternoon" });
  });

  it("smooths body weight over seven days", () => {
    expect(movingAverage([{ date: "2026-10-01", kg: 80 }, { date: "2026-10-03", kg: 82 }, { date: "2026-10-09", kg: 84 }])).toEqual([
      { date: "2026-10-01", kg: 80 },
      { date: "2026-10-03", kg: 81 },
      { date: "2026-10-09", kg: 83 },
    ]);
  });

  it("adds it all up for a period", () => {
    const log = [entry("2026-10-26", "bench", [set(60, 10)]), entry("2026-10-26", "assist", [set(40, 8)]), entry("2026-10-28", "squat", [set(100, 5)])];
    const s = summarize(log, [meal("2026-10-26", "morning")], [{ date: "2026-10-27", kg: 86 }], [], new Set(["assist"]), { start: "2026-10-26", end: "2026-11-01" }, today);
    expect(s).toEqual({ sessions: 2, volume: 1100, prs: 0, perWeek: 2, meals: { logged: 1, possible: 21 }, body: { from: 86, to: 86 } });
  });
});

describe("goal progress", () => {
  const log = [
    entry("2026-09-28", "bench", [set(60, 8)]),
    entry("2026-10-05", "bench", [set(62.5, 8)]),
    entry("2026-10-26", "bench", [set(65, 8)]),
  ];

  it("measures from before the goal was set to the best of the last four weeks", () => {
    const g = goalProgress(log, "bench", 80, "2026-10-01", today)!;
    expect(Math.round(g.start)).toBe(76);
    expect(Math.round(g.current * 10) / 10).toBe(82.3);
    expect(g.reached).toBe(true);
  });

  it("estimates when the target is reached at the pace so far", () => {
    const g = goalProgress(log, "bench", 90, "2026-10-01", today)!;
    expect(g.reached).toBe(false);
    expect(g.pct).toBeGreaterThan(0);
    expect(g.eta && g.eta > today).toBe(true);
    expect(goalProgress([], "bench", 90, "2026-10-01", today)).toBeNull();
  });
});

describe("recap", () => {
  it("sums up the week in sentences", () => {
    const log = [entry("2026-10-20", "bench", [set(60, 8)]), entry("2026-10-27", "bench", [set(65, 8)]), entry("2026-10-29", "squat", [set(100, 5)])];
    const prs = findPrs(log, byId);
    const r = recap("week", { entries: log, meals: [], weights: [], prs, assisted: new Set(), byId, describeSet: (s) => `${s.weight_kg} kg × ${s.reps}` }, today);
    expect(r.title).toBe("Week of 26 Oct");
    expect(r.lines).toEqual([
      "2 sessions (1 the week before).",
      "1 PR: bench 65 kg × 8.",
      "Volume 1,020 kg (+113% on the week before).",
      "Trained on 2 of 7 days.",
      "0 of 21 meals logged.",
    ]);
  });
});
