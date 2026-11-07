import { describe, expect, it } from "vitest";
import { monthGrid, shiftMonth, weekOf } from "../src/lib/log/dates";
import {
  columnsFor,
  entriesVolume,
  fmtTime,
  loggedExercises,
  parseTime,
  plural,
  progressOf,
  readRows,
  recentExercises,
  setCount,
  setDetail,
  setLabels,
  setToRow,
  setsSummary,
  setsVolume,
  timeInput,
  variantSuggestions,
  weightSummary,
  type DraftRow,
} from "../src/lib/log/sets";
import type { Entry, Exercise, Metric, SetValues, Side } from "../src/lib/log/types";

const set = (over: Partial<SetValues> = {}): SetValues => ({
  weight_kg: null, reps: null, duration_s: null, distance_km: null, rounds: null, rpe: null, calories: null, tempo: null, side: null, ...over,
});
const lift = (weight_kg: number, reps: number) => set({ weight_kg, reps });
const row = (values: Partial<Record<Metric, string>>, side: Side | null = null, tempo = ""): DraftRow => ({ key: "k", side, tempo, values });
const entry = (over: Partial<Entry>): Entry => ({ id: "e", date: "2026-11-01", exercise_id: "x", position: 0, variant: null, notes: null, tempo: null, sets: [], ...over });
const exercise = (over: Partial<Exercise>): Exercise => ({
  id: "x", name: "X", category: "Chest", secondary_muscles: [], equipment: null, kind: "weighted", inputs: ["weight_kg", "reps"],
  per_side: false, assisted: false, is_custom: false, created_by: null, ...over,
});

describe("wording", () => {
  it("doesn't say 1 sets", () => {
    expect([plural(1, "set"), plural(2, "set"), plural(0, "meal")]).toEqual(["1 set", "2 sets", "0 meals"]);
  });
});

describe("time", () => {
  it("reads a hold in seconds and a run in minutes, which is what people mean", () => {
    expect(parseTime("45", "timed")).toBe(45);
    expect(parseTime("20", "cardio")).toBe(1200);
    expect(parseTime("30", "session")).toBe(1800);
  });

  it("reads m:ss the same for every exercise", () => {
    expect(parseTime("1:30", "timed")).toBe(90);
    expect(parseTime("1:30", "cardio")).toBe(90);
  });

  it("refuses anything else", () => {
    for (const text of ["abc", "1:75", "1.5", "-3", ""]) expect(parseTime(text, "timed")).toBeNull();
  });

  it("puts back in the form what would read the same again", () => {
    for (const [seconds, kind] of [[45, "timed"], [90, "timed"], [1200, "cardio"], [1290, "cardio"], [1800, "session"]] as const) {
      expect(parseTime(timeInput(seconds, kind), kind)).toBe(seconds);
    }
    expect(timeInput(1200, "cardio")).toBe("20");
    expect(timeInput(45, "timed")).toBe("45");
  });

  it("formats for reading", () => {
    expect([fmtTime(45), fmtTime(1200), fmtTime(90)]).toEqual(["45s", "20 min", "1:30"]);
  });
});

describe("summaries", () => {
  it("collapses like v1", () => {
    expect(setsSummary([lift(60, 12), lift(65, 12), lift(70, 12)])).toBe("3 × 12");
    expect(setsSummary([lift(60, 12), lift(65, 10)])).toBe("2 × …");
    expect(setsSummary([set({ duration_s: 45 }), set({ duration_s: 45 })])).toBe("2 × 45s");
    expect(setsSummary([set({ duration_s: 1200 })])).toBe("20 min");
    expect(setsSummary([])).toBe("");
  });

  it("shows a weight range, and doesn't call a run bodyweight", () => {
    expect(weightSummary([lift(60, 8), lift(70, 8)], "weighted")).toBe("60–70 kg");
    expect(weightSummary([lift(60, 8), lift(60, 8)], "weighted")).toBe("60 kg");
    expect(weightSummary([set({ reps: 10 })], "bodyweight")).toBe("Bodyweight");
    expect(weightSummary([set({ duration_s: 600 })], "cardio")).toBe("");
    expect(weightSummary([set({ duration_s: 600, distance_km: 2.5 })], "cardio")).toBe("2.5 km");
  });

  it("adds up volume from weight and reps only", () => {
    expect(setsVolume([lift(60, 10), lift(70, 5), set({ duration_s: 45 }), set({ reps: 10 })])).toBe(950);
  });

  it("lists every kind of figure on a set", () => {
    expect(setDetail(set({ reps: 8, rpe: 7.5 }))).toBe("8 reps · RPE 7.5");
    expect(setDetail(set({ duration_s: 1200, distance_km: 3, calories: 200, rounds: 2 }))).toBe("20 min · 3 km · 2 rounds · 200 kcal");
    expect(setDetail(set())).toBe("—");
  });
});

describe("one-sided sets", () => {
  const sides = (...list: (Side | null)[]) => list.map((side) => set({ side, reps: 5 }));

  it("count left and right as one set", () => {
    expect(setCount(sides("left", "right", "left", "right"))).toBe(2);
    expect(setCount(sides("left", "right", "left"))).toBe(2);
    expect(setCount(sides(null, null))).toBe(2);
  });

  it("label each side under the same number", () => {
    expect(setLabels(sides("left", "right", "left", "right"))).toEqual(["Set 1 L", "Set 1 R", "Set 2 L", "Set 2 R"]);
    expect(setLabels(sides(null, null))).toEqual(["Set 1", "Set 2"]);
    expect(setLabels(sides("left", "left", "right"))).toEqual(["Set 1 L", "Set 2 L", "Set 2 R"]);
  });
});

describe("reading the form", () => {
  it("reads each row and drops the empty ones", () => {
    const { sets, error } = readRows([row({ weight_kg: "62.5", reps: "8" }), row({}), row({ weight_kg: "0", reps: "0" })], "weighted");
    expect(error).toBeUndefined();
    expect(sets).toEqual([lift(62.5, 8)]);
  });

  it("keeps a set with only reps, only weight or only time", () => {
    expect(readRows([row({ reps: "10" })], "bodyweight").sets).toEqual([set({ reps: 10 })]);
    expect(readRows([row({ weight_kg: "20" })], "weighted").sets).toEqual([set({ weight_kg: 20 })]);
    expect(readRows([row({ duration_s: "20" })], "cardio").sets).toEqual([set({ duration_s: 1200 })]);
  });

  it("names the set that's wrong instead of saving nonsense", () => {
    expect(readRows([row({ reps: "8" }), row({ reps: "2.5" })], "weighted").error).toBe("Set 2: check the reps.");
    expect(readRows([row({ weight_kg: "-5" })], "weighted").error).toBe("Set 1: check the weight.");
    expect(readRows([row({ rpe: "11" })], "weighted").error).toBe("Set 1: check the RPE.");
    expect(readRows([row({ duration_s: "soon" })], "cardio").error).toBe("Set 1: write the time in minutes or m:ss.");
    expect(readRows([row({ reps: "8" }, null, "fast")], "weighted").error).toBe("Set 1: write the tempo like 3-1-1-0.");
  });

  it("accepts tempo with X in any case, and keeps the side", () => {
    expect(readRows([row({ reps: "8" }, "left", "2-0-x-0")], "weighted").sets).toEqual([set({ reps: 8, side: "left", tempo: "2-0-X-0" })]);
  });

  it("round-trips a saved set", () => {
    const saved = set({ weight_kg: 60, reps: 8, duration_s: 1290, side: "right", tempo: "3-1-1-0" });
    expect(readRows([setToRow(saved, "cardio", "k")], "cardio").sets).toEqual([saved]);
  });

  it("asks for what the exercise logs, plus anything already logged", () => {
    expect(columnsFor(exercise({ inputs: ["duration_s", "distance_km"] }))).toEqual(["duration_s", "distance_km"]);
    expect(columnsFor(exercise({ inputs: ["reps", "tempo"] }))).toEqual(["reps"]);
    expect(columnsFor(exercise({ inputs: ["reps"] }), [set({ reps: 5, calories: 30 })])).toEqual(["reps", "calories"]);
    expect(columnsFor(undefined)).toEqual(["weight_kg", "reps"]);
  });
});

describe("progress", () => {
  it("works out each day's top set, Epley 1RM and volume", () => {
    const days = progressOf(
      [
        entry({ date: "2026-11-02", sets: [lift(60, 10), lift(70, 5)] }),
        entry({ date: "2026-11-01", sets: [lift(50, 10)] }),
        entry({ date: "2026-11-02", sets: [lift(30, 10)] }),
        entry({ date: "2026-11-02", exercise_id: "other", sets: [lift(200, 1)] }),
      ],
      "x",
    );
    expect(days.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(days[1].top).toBe(70);
    expect(days[1].volume).toBe(600 + 350 + 300);
    expect(days[1].e1rm).toBeCloseTo(81.67, 2);
  });

  it("treats assistance as help, not weight lifted", () => {
    const days = progressOf(
      [entry({ date: "2026-07-20", sets: [lift(45, 8), lift(55, 6), lift(60, 6)] }), entry({ date: "2026-07-27", sets: [lift(40, 8), set({ reps: 2 })] })],
      "x",
      true,
    );
    expect(days.map((d) => d.assist)).toEqual([45, 40]);
    expect(days.map((d) => [d.top, d.e1rm, d.volume])).toEqual([[0, 0, 0], [0, 0, 0]]);
    expect(weightSummary([lift(45, 8), lift(60, 6)], "weighted", true)).toBe("45–60 kg assist");
    expect(weightSummary([set({ reps: 5 })], "weighted", true)).toBe("No assistance");
  });

  it("leaves assisted exercises out of volume lifted", () => {
    const list = [entry({ exercise_id: "a", sets: [lift(60, 10)] }), entry({ exercise_id: "b", sets: [lift(50, 10)] })];
    expect(entriesVolume(list)).toBe(1100);
    expect(entriesVolume(list, new Set(["b"]))).toBe(600);
  });

  it("suggests variants written before, newest first, then common ones", () => {
    const list = [
      entry({ exercise_id: "x", date: "2026-07-01", variant: "Low row machine" }),
      entry({ exercise_id: "x", date: "2026-07-09", variant: "machine" }),
      entry({ exercise_id: "y", date: "2026-07-10", variant: "Incline" }),
    ];
    expect(variantSuggestions(list, "x", ["Machine", "Cable"])).toEqual(["machine", "Low row machine", "Cable"]);
    expect(variantSuggestions(list, null, ["Machine"])).toEqual(["Machine"]);
  });

  it("tracks time for holds", () => {
    const [day] = progressOf([entry({ sets: [set({ duration_s: 45 }), set({ duration_s: 30 })] })], "x");
    expect(day).toMatchObject({ top: 0, e1rm: 0, time: 75, longest: 45 });
  });

  it("orders logged exercises by use and recent ones by date", () => {
    const list = [exercise({ id: "a", name: "A" }), exercise({ id: "b", name: "B" }), exercise({ id: "c", name: "C" })];
    const entries = [
      entry({ exercise_id: "a", date: "2026-10-01" }),
      entry({ exercise_id: "b", date: "2026-10-02" }),
      entry({ exercise_id: "b", date: "2026-10-03" }),
    ];
    expect(loggedExercises(entries, list).map((e) => e.id)).toEqual(["b", "a"]);
    expect(recentExercises(entries)).toEqual(["b", "a"]);
  });
});

describe("dates", () => {
  it("builds weeks from Monday, across a month boundary", () => {
    const week = weekOf("2026-11-01");
    expect(week[0]).toBe("2026-10-26");
    expect(week[6]).toBe("2026-11-01");
  });

  it("builds a six-week month grid starting on a Monday", () => {
    const grid = monthGrid("2026-11-15");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-10-26");
    expect(grid).toContain("2026-11-30");
  });

  it("shifts months without skipping short ones", () => {
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftMonth("2026-01-15", -1)).toBe("2025-12-01");
  });
});
