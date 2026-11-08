/**
 * What M7 adds to the rules: routines, and plans that put one on a day, by the
 * person themselves or by their coach.
 */
import { describe, expect, it } from "vitest";
import { openDb } from "./harness";

const { as, rows, newUser, connect } = await openDb();
const one = async (sql: string, params: unknown[] = []) => (await rows(sql, params))[0];
const exerciseId = async (name: string) => (await one("select id from public.exercises where name = $1 and not is_custom", [name])).id as string;

type Item = { exercise_id: string; target_sets?: number; target_reps?: string; target_tempo?: string; variant?: string };

const saveRoutine = (who: string, name: string, items: Item[], id: string | null = null) =>
  as(who, async () => (await one("select public.save_routine($1, $2, null, $3) as id", [id, name, JSON.stringify(items)])).id as string);

const plan = (who: string, template: string, user: string, date: string, replace = false) =>
  as(who, async () => (await one("select public.plan_routine($1, $2, $3, $4) as id", [template, user, date, replace])).id as string);

describe("routines", () => {
  it("are saved with their exercises in order, and only their owner sees them", async () => {
    const me = await newUser();
    const other = await newUser();
    const bench = await exerciseId("Bench Press");
    const dips = await exerciseId("Deadlift");
    const id = await saveRoutine(me, "Push Day", [
      { exercise_id: bench, target_sets: 4, target_reps: "6-8", target_tempo: "3-1-1-0" },
      { exercise_id: dips, target_sets: 3, target_reps: "10" },
    ]);
    await as(me, async () => {
      expect(await rows("select exercise_id, position, target_sets, target_reps, target_tempo from public.template_items where template_id = $1 order by position", [id])).toEqual([
        { exercise_id: bench, position: 0, target_sets: 4, target_reps: "6-8", target_tempo: "3-1-1-0" },
        { exercise_id: dips, position: 1, target_sets: 3, target_reps: "10", target_tempo: null },
      ]);
    });
    await as(other, async () => {
      expect(await rows("select id from public.templates")).toEqual([]);
      expect(await rows("select id from public.template_items")).toEqual([]);
    });
  });

  it("are replaced whole on save, and can't be taken over by someone else", async () => {
    const me = await newUser();
    const other = await newUser();
    const bench = await exerciseId("Bench Press");
    const squat = await exerciseId("Squat");
    const id = await saveRoutine(me, "Day A", [{ exercise_id: bench }]);
    await saveRoutine(me, "Day A2", [{ exercise_id: squat }], id);
    await as(me, async () => {
      expect(await rows("select name from public.templates where id = $1", [id])).toEqual([{ name: "Day A2" }]);
      expect(await rows("select exercise_id from public.template_items where template_id = $1", [id])).toEqual([{ exercise_id: squat }]);
    });
    await expect(saveRoutine(other, "Mine now", [{ exercise_id: bench }], id)).rejects.toThrow();
    await as(me, async () => expect(await rows("select name from public.templates where id = $1", [id])).toEqual([{ name: "Day A2" }]));
  });

  it("need an exercise, a unique name, and readable targets", async () => {
    const me = await newUser();
    const bench = await exerciseId("Bench Press");
    await expect(saveRoutine(me, "Empty", [])).rejects.toThrow(/empty_routine/);
    await saveRoutine(me, "Legs", [{ exercise_id: bench }]);
    await expect(saveRoutine(me, "legs", [{ exercise_id: bench }])).rejects.toThrow(/templates_name/);
    await expect(saveRoutine(me, "Bad reps", [{ exercise_id: bench, target_reps: "eight" }])).rejects.toThrow(/target_reps/);
    await expect(saveRoutine(me, "Bad tempo", [{ exercise_id: bench, target_tempo: "slow" }])).rejects.toThrow(/target_tempo/);
  });

  it("can't hold someone else's custom exercise", async () => {
    const me = await newUser();
    const other = await newUser();
    const [custom] = await as(other, () =>
      rows("insert into public.exercises (name, category, kind, inputs, is_custom, created_by) values ('Secret Move', 'Chest', 'weighted', '{weight_kg,reps}', true, $1) returning id", [other]),
    );
    await expect(saveRoutine(me, "Sneaky", [{ exercise_id: custom.id as string }])).rejects.toThrow(/row-level security/);
  });
});

describe("plans", () => {
  it("copy the routine onto a day, so later edits to the routine don't change it", async () => {
    const me = await newUser();
    const bench = await exerciseId("Bench Press");
    const squat = await exerciseId("Squat");
    const routine = await saveRoutine(me, "Push Day", [{ exercise_id: bench, target_sets: 3 }]);
    const id = await plan(me, routine, me, "2026-11-10");
    await saveRoutine(me, "Leg Day", [{ exercise_id: squat }], routine);
    await as(me, async () => {
      expect(await rows("select name, assigned_by from public.assignments where id = $1", [id])).toEqual([{ name: "Push Day", assigned_by: me }]);
      expect(await rows("select exercise_id, target_sets from public.assignment_items where assignment_id = $1", [id])).toEqual([{ exercise_id: bench, target_sets: 3 }]);
    });
    // Nobody else was told: it's your own plan.
    expect(await rows("select id from public.notifications where user_id = $1", [me])).toEqual([]);
  });

  it("are one per day, replaced only when asked", async () => {
    const me = await newUser();
    const bench = await exerciseId("Bench Press");
    const a = await saveRoutine(me, "A", [{ exercise_id: bench }]);
    const b = await saveRoutine(me, "B", [{ exercise_id: bench }]);
    await plan(me, a, me, "2026-11-11");
    await expect(plan(me, b, me, "2026-11-11")).rejects.toThrow(/already_planned/);
    await plan(me, b, me, "2026-11-11", true);
    await as(me, async () => expect(await rows("select name from public.assignments where date = '2026-11-11'")).toEqual([{ name: "B" }]));
  });

  it("can be made by a coach who may log workouts, and the client is told", async () => {
    const client = await newUser();
    const coach = await newUser("coach");
    const stranger = await newUser("coach");
    await connect(client, coach, "coach");
    const bench = await exerciseId("Bench Press");
    const routine = await saveRoutine(coach, "Push Day", [{ exercise_id: bench, target_tempo: "3-1-1-0" }]);
    const strangers = await saveRoutine(stranger, "Push Day", [{ exercise_id: bench }]);

    const id = await plan(coach, routine, client, "2026-11-12");
    await expect(plan(stranger, strangers, client, "2026-11-13")).rejects.toThrow(/not_allowed/);
    // A routine is used by its owner only, even by the client it would be for.
    await expect(plan(client, routine, client, "2026-11-13")).rejects.toThrow(/no_such_routine/);

    await as(client, async () => {
      expect(await rows("select name, assigned_by from public.assignments")).toEqual([{ name: "Push Day", assigned_by: coach }]);
      expect(await rows("select target_tempo from public.assignment_items where assignment_id = $1", [id])).toEqual([{ target_tempo: "3-1-1-0" }]);
      // The plan is theirs to read; the coach's routine isn't.
      expect(await rows("select id from public.templates")).toEqual([]);
    });
    const [note] = await rows("select type, actor_id, payload from public.notifications where user_id = $1", [client]);
    expect(note).toMatchObject({ type: "plan_added", actor_id: coach, payload: { assignment_id: id, date: "2026-11-12", name: "Push Day" } });
  });

  it("can't be made by a coach the client doesn't share workouts with", async () => {
    const client = await newUser();
    const coach = await newUser("coach");
    await connect(client, coach, "coach", { share_workouts: false });
    const routine = await saveRoutine(coach, "Push", [{ exercise_id: await exerciseId("Bench Press") }]);
    await expect(plan(coach, routine, client, "2026-11-12")).rejects.toThrow(/not_allowed/);
  });

  it("make a coach's custom exercise readable to the client it's planned for, and loggable", async () => {
    const client = await newUser();
    const coach = await newUser("coach");
    const friend = await newUser();
    await connect(client, coach, "coach");
    const [custom] = await as(coach, () =>
      rows("insert into public.exercises (name, category, kind, inputs, is_custom, created_by) values ('Coach Press', 'Chest', 'weighted', '{weight_kg,reps}', true, $1) returning id", [coach]),
    );
    const routine = await saveRoutine(coach, "Special", [{ exercise_id: custom.id as string }]);
    await as(client, async () => expect(await rows("select id from public.exercises where id = $1", [custom.id])).toEqual([]));
    await plan(coach, routine, client, "2026-11-14");
    await as(client, async () => {
      expect(await rows("select name from public.exercises where id = $1", [custom.id])).toEqual([{ name: "Coach Press" }]);
      await rows("select public.save_session_exercise(gen_random_uuid(), $1, '2026-11-14', $2, null, null, null, $3)", [
        client,
        custom.id,
        JSON.stringify([{ weight_kg: 40, reps: 10 }]),
      ]);
    });
    // Someone the client doesn't share with sees neither.
    await as(friend, async () => {
      expect(await rows("select id from public.exercises where id = $1", [custom.id])).toEqual([]);
      expect(await rows("select id from public.assignments where user_id = $1", [client])).toEqual([]);
    });
  });

  it("are seen by friends who see workouts, who can't change them", async () => {
    const owner = await newUser();
    const friend = await newUser();
    await connect(owner, friend, "friend");
    const routine = await saveRoutine(owner, "Pull", [{ exercise_id: await exerciseId("Deadlift") }]);
    const id = await plan(owner, routine, owner, "2026-11-15");
    await as(friend, async () => {
      expect(await rows("select name from public.assignments")).toEqual([{ name: "Pull" }]);
      expect((await rows("select id from public.assignment_items")).length).toBe(1);
    });
    await expect(as(friend, () => rows("select public.remove_plan($1)", [id]))).rejects.toThrow(/not_allowed/);
    await expect(as(friend, () => rows("select public.skip_plan($1, true)", [id]))).rejects.toThrow(/not_allowed/);
    await expect(as(friend, () => rows("delete from public.assignments where id = $1", [id]))).rejects.toThrow(/permission denied/);
  });

  it("are skipped by the owner only, and removed by the owner or the coach who made them", async () => {
    const client = await newUser();
    const coach = await newUser("coach");
    await connect(client, coach, "coach");
    const bench = await exerciseId("Bench Press");
    const routine = await saveRoutine(coach, "Push", [{ exercise_id: bench }]);
    const own = await saveRoutine(client, "My day", [{ exercise_id: bench }]);
    const coachPlan = await plan(coach, routine, client, "2026-11-16");
    const clientPlan = await plan(client, own, client, "2026-11-17");

    await expect(as(coach, () => rows("select public.skip_plan($1, true)", [coachPlan]))).rejects.toThrow(/not_allowed/);
    await as(client, () => rows("select public.skip_plan($1, true)", [coachPlan]));
    expect((await one("select skipped_at from public.assignments where id = $1", [coachPlan])).skipped_at).not.toBeNull();
    await as(client, () => rows("select public.skip_plan($1, false)", [coachPlan]));
    expect((await one("select skipped_at from public.assignments where id = $1", [coachPlan])).skipped_at).toBeNull();

    // The coach can't remove or overwrite the client's own plan.
    await expect(as(coach, () => rows("select public.remove_plan($1)", [clientPlan]))).rejects.toThrow(/not_allowed/);
    await expect(plan(coach, routine, client, "2026-11-17", true)).rejects.toThrow(/already_planned/);

    await as(coach, () => rows("select public.remove_plan($1)", [coachPlan]));
    const [removed] = await rows("select payload from public.notifications where user_id = $1 and type = 'plan_removed'", [client]);
    expect(removed.payload).toEqual({ date: "2026-11-16", name: "Push" });

    await as(client, () => rows("select public.remove_plan($1)", [clientPlan]));
    expect(await rows("select id from public.assignments where user_id = $1", [client])).toEqual([]);
  });
});
