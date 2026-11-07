import { describe, expect, it } from "vitest";
import { readSets, stableId, toDate, transform } from "../scripts/import-v1/transform.mjs";
import { driveDownloadUrl } from "../scripts/import-v1/write.mjs";

const OWNER = "11111111-1111-4111-8111-111111111111";

const row = (over = {}) => ({
  id: "a1",
  timestamp: "Tue Jul 21 2026 22:58:23 GMT+0700 (Waktu Indochina)",
  date: "2026-07-20",
  exercise: "Bench Press",
  variant: "",
  notes: "",
  setList: [{ w: 60, r: 8 }],
  ...over,
});
const meal = (over = {}) => ({ id: "m1", timestamp: "", date: "2026-07-20", slot: "morning", food: "Oats", notes: "", photoUrl: "", ...over });

describe("reading sets", () => {
  it("reads a hold typed as weight with the time in the note", () => {
    const { sets, corrected } = readSets(row({ setList: [{ w: 50, r: 0 }], notes: "30 detik" }));
    expect(sets).toEqual([{ w: 0, r: 0, t: 30 }]);
    expect(corrected).toBe(true);
  });

  it("reads minutes", () => {
    expect(readSets(row({ setList: [{ w: 1, r: 0 }], notes: "20 menit" })).sets).toEqual([{ w: 0, r: 0, t: 1200 }]);
    expect(readSets(row({ setList: [{ w: 1, r: 0 }], notes: "10 min" })).sets[0].t).toBe(600);
  });

  it("scales a timed set whose note gives only the unit", () => {
    expect(readSets(row({ setList: [{ w: 0, r: 0, t: 20 }], notes: "Menit" })).sets).toEqual([{ w: 0, r: 0, t: 1200 }]);
  });

  it("leaves ordinary lifts alone, even when the note mentions time", () => {
    const list = [{ w: 60, r: 8 }];
    const { sets, corrected } = readSets(row({ setList: list, notes: "rest 2 menit between sets" }));
    expect(sets).toEqual([{ w: 60, r: 8, t: 0 }]);
    expect(corrected).toBe(false);
  });

  it("leaves real timed sets alone", () => {
    const { sets, corrected } = readSets(row({ setList: [{ w: 0, r: 0, t: 45 }], notes: "30 detik last time" }));
    expect(sets[0].t).toBe(45);
    expect(corrected).toBe(false);
  });

  it("doesn't mistake a word containing a unit for a unit", () => {
    const { corrected } = readSets(row({ setList: [{ w: 20, r: 0 }], notes: "minimal effort, 5 minggu lagi" }));
    expect(corrected).toBe(false);
  });

  it("drops empty sets and bad values", () => {
    const { sets } = readSets(row({ setList: [{ w: 0, r: 0 }, { w: "x", r: 5 }, null] }));
    expect(sets).toEqual([{ w: 0, r: 5, t: 0 }]);
  });
});

describe("dates", () => {
  it("normalises the shapes Sheets hands back", () => {
    expect(toDate("2026-7-2")).toBe("2026-07-02");
    expect(toDate("20/07/2026")).toBe("2026-07-20");
    expect(toDate("nonsense")).toBe("");
  });
});

describe("transform", () => {
  it("merges spellings of one lift, using the most-used one and known typos", () => {
    const plan = transform(
      {
        workouts: [
          row({ id: "1", exercise: "chest  press" }),
          row({ id: "2", exercise: "Chest Press" }),
          row({ id: "3", exercise: "Chest Press" }),
          row({ id: "4", exercise: "Chess Press" }),
        ],
      },
      OWNER,
    );
    expect(plan.exercises.map((e) => e.name)).toEqual(["Chest Press"]);
    expect(plan.exercises[0].category).toBe("Chest");
    expect(new Set(plan.sessionExercises.map((e) => e.exercise_id)).size).toBe(1);
    expect(plan.report.renamed).toHaveLength(1);
  });

  it("doesn't merge lifts that are only similar", () => {
    const plan = transform({ workouts: [row({ id: "1", exercise: "Seated Row" }), row({ id: "2", exercise: "Low Row" })] }, OWNER);
    expect(plan.exercises).toHaveLength(2);
  });

  it("uses an existing exercise, preferring a built-in", () => {
    const plan = transform({ workouts: [row()] }, OWNER, [
      { id: "mine", name: "bench press", is_custom: true },
      { id: "builtin", name: "Bench Press", is_custom: false },
    ]);
    expect(plan.exercises).toEqual([]);
    expect(plan.sessionExercises[0].exercise_id).toBe("builtin");
    expect(plan.reusedExercises).toBe(1);
  });

  it("groups a day's rows into one session, in order, with their sets", () => {
    const plan = transform(
      { workouts: [row({ id: "1", variant: "Mesin", notes: "good" }), row({ id: "2", exercise: "Squat", setList: [{ w: 80, r: 5 }, { w: 90, r: 5 }] })] },
      OWNER,
    );
    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0].created_by).toBe(OWNER);
    expect(plan.sessionExercises.map((e) => e.position)).toEqual([0, 1]);
    expect(plan.sessionExercises[0]).toMatchObject({ variant: "Mesin", notes: "good" });
    expect(plan.sets.map((s) => s.set_no)).toEqual([1, 1, 2]);
    expect(plan.sets[2]).toMatchObject({ weight_kg: 90, reps: 5, duration_s: null });
  });

  it("offers only the inputs an exercise was really logged with", () => {
    const plan = transform({ workouts: [row({ exercise: "Lunge", setList: [{ w: 0, r: 10 }] }), row({ id: "2", exercise: "Plank", setList: [{ w: 0, r: 0, t: 30 }] })] }, OWNER);
    expect(plan.exercises.find((e) => e.name === "Lunge")?.inputs).toEqual(["reps"]);
    expect(plan.exercises.find((e) => e.name === "Plank")?.inputs).toEqual(["duration_s"]);
  });

  it("flags names it can't categorise instead of guessing silently", () => {
    const plan = transform({ workouts: [row({ exercise: "Sandbag Carry" })] }, OWNER);
    expect(plan.exercises[0].category).toBe("Full body & conditioning");
    expect(plan.report.uncategorised).toEqual(["Sandbag Carry"]);
  });

  it("keeps one meal per slot per day, the later one, and tolerates a bad slot", () => {
    const plan = transform({ meals: [meal({ food: "Oats" }), meal({ id: "m2", food: "Eggs" }), meal({ id: "m3", slot: "brunch", date: "2026-07-21" })] }, OWNER);
    expect(plan.meals).toHaveLength(2);
    expect(plan.meals[0].description).toBe("Eggs");
    expect(plan.meals[1].slot).toBe("morning");
    expect(plan.report.duplicateMeals).toHaveLength(1);
  });

  it("reports what it skips", () => {
    const plan = transform({ workouts: [row({ date: "bad" }), row({ exercise: "  " })], meals: [meal({ date: "bad" })] }, OWNER);
    expect(plan.sessions).toEqual([]);
    expect(plan.meals).toEqual([]);
    expect(plan.report.skipped).toHaveLength(3);
  });

  it("gives the same ids every run, and different ids to different people", () => {
    const data = { workouts: [row()], meals: [meal()] };
    const first = transform(data, OWNER);
    expect(transform(data, OWNER)).toEqual(first);

    const other = transform(data, "22222222-2222-4222-8222-222222222222");
    expect(other.sessions[0].id).not.toBe(first.sessions[0].id);
    expect(other.sets[0].id).not.toBe(first.sets[0].id);
    expect(stableId(OWNER, "set", "x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("photo links", () => {
  it("turns a Drive share link into a download link", () => {
    const id = "1AbCdEfGhIjKlMnOp";
    expect(driveDownloadUrl(`https://drive.google.com/file/d/${id}/view?usp=sharing`)).toBe(`https://drive.google.com/uc?export=download&id=${id}`);
    expect(driveDownloadUrl("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
  });
});
