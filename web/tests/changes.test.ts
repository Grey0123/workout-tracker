import { describe, expect, it } from "vitest";
import { describeGroup, fmtSet, groupByTx, sentence, type Change, type ChangeContext } from "../src/lib/coach/changes";

let seq = 0;
const change = (table_name: string, op: Change["op"], before: Change["before"], after: Change["after"], over: Partial<Change> = {}): Change => ({
  id: `h${++seq}`,
  table_name,
  op,
  row_id: String((after ?? before)?.id ?? "row"),
  changed_by: "coach",
  changed_at: "2026-10-27T12:40:00Z",
  tx: "1",
  before,
  after,
  ...over,
});
const set = (set_no: number, weight_kg: number | null, reps: number | null, extra = {}) => ({ id: `s${set_no}`, session_exercise_id: "e1", set_no, weight_kg, reps, ...extra });
const entry = (extra = {}) => ({ id: "e1", session_id: "sess", exercise_id: "bench", variant: null, notes: null, tempo: null, ...extra });

const ctx: ChangeContext = {
  exerciseName: (id) => ({ bench: "Bench Press", squat: "Squat" })[id],
  entry: (id) => (id === "e1" ? { exerciseId: "bench", date: "2026-10-27" } : undefined),
  sessionDate: (id) => (id === "sess" ? "2026-10-27" : undefined),
  whose: "your",
};

describe("describing a change", () => {
  it("says the PRD's example the way the PRD does", () => {
    const [d] = describeGroup([change("sets", "UPDATE", set(2, 60, 8), set(2, 65, 8))], ctx);
    expect(sentence("Coach Andi", d)).toBe("Coach Andi changed Bench Press set 2 on Tue 27 Oct: 60 kg × 8 → 65 kg × 8");
    expect(d.target).toEqual({ table: "session_exercises", id: "e1" });
  });

  it("lists every set when several changed", () => {
    const [d] = describeGroup(
      [
        change("sets", "UPDATE", set(1, 60, 8), set(1, 62.5, 8)),
        change("sets", "INSERT", null, set(3, 65, 6)),
        change("sets", "DELETE", set(2, 60, 8), null),
      ],
      ctx,
    );
    expect(d.what).toBe("changed Bench Press");
    expect(d.details).toEqual(["set 1: 60 kg × 8 → 62.5 kg × 8", "removed set 2: 60 kg × 8", "added set 3: 65 kg × 6"]);
  });

  it("sums up an added or deleted exercise with its sets", () => {
    const added = describeGroup(
      [change("sessions", "INSERT", null, { id: "sess", date: "2026-10-27" }), change("session_exercises", "INSERT", null, entry()), change("sets", "INSERT", null, set(1, 60, 8)), change("sets", "INSERT", null, set(2, 65, 8))],
      ctx,
    );
    expect(added.map((d) => sentence("Coach Andi", d))).toEqual(["Coach Andi added Bench Press on Tue 27 Oct: 2 sets: 60 kg × 8, 65 kg × 8"]);

    const gone = describeGroup(
      [change("session_exercises", "DELETE", entry({ id: "e9" }), null), change("sets", "DELETE", { ...set(1, 60, 8), session_exercise_id: "e9" }, null)],
      ctx,
    );
    expect(sentence("Coach Andi", gone[0])).toBe("Coach Andi deleted Bench Press on Tue 27 Oct: 1 set: 60 kg × 8");
  });

  it("names a swapped exercise and changed text", () => {
    const [d] = describeGroup([change("session_exercises", "UPDATE", entry(), entry({ exercise_id: "squat", variant: "Paused", tempo: "3-1-1-0" }))], ctx);
    expect(d.details).toEqual(["Bench Press → Squat", "added variant “Paused”", "added tempo “3-1-1-0”"]);
  });

  it("covers meals, from either side", () => {
    const meal = { id: "m1", date: "2026-10-27", slot: "morning", description: "Oats", notes: null, photo_path: null, deleted_at: null };
    expect(sentence("Coach Andi", describeGroup([change("meals", "INSERT", null, meal)], ctx)[0])).toBe("Coach Andi added your morning meal on Tue 27 Oct: “Oats”");
    const edited = describeGroup([change("meals", "UPDATE", meal, { ...meal, description: "Eggs", photo_path: "a.jpg" })], { ...ctx, whose: "their" })[0];
    expect(edited.what).toBe("changed their morning meal");
    expect(edited.details).toEqual(["food “Oats” → “Eggs”", "added a photo"]);
    expect(describeGroup([change("meals", "UPDATE", meal, { ...meal, deleted_at: "now" })], ctx)[0].what).toBe("deleted your morning meal");
  });

  it("formats every kind of set", () => {
    expect([fmtSet({ weight_kg: 60, reps: 8 }), fmtSet({ reps: 12 }), fmtSet({ duration_s: 1200, distance_km: 3.2 }), fmtSet({ weight_kg: 20, reps: 10, side: "left", rpe: 8 })]).toEqual([
      "60 kg × 8",
      "12 reps",
      "20 min · 3.2 km",
      "20 kg × 10 · RPE 8 · left",
    ]);
  });

  it("keeps each save's rows together, newest first", () => {
    const rows = [change("sets", "UPDATE", set(1, 1, 1), set(1, 2, 1), { tx: "9" }), change("sets", "UPDATE", set(2, 1, 1), set(2, 2, 1), { tx: "9" }), change("sets", "UPDATE", set(1, 0, 1), set(1, 1, 1), { tx: "4" })];
    expect(groupByTx(rows).map((g) => g.map((c) => c.tx))).toEqual([["9", "9"], ["4"]]);
  });
});
