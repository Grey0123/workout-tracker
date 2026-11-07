/**
 * The coach workspace (PRD 5.3): a coach logs for a client, the client sees exactly
 * what changed and can undo it. The access rules themselves are in access-rules.test.ts.
 */
import { describe, expect, it } from "vitest";
import { openDb } from "./harness";

const { as, rows, newUser, connect } = await openDb();

const one = async (sql: string, params: unknown[] = []) => (await rows(sql, params))[0];
const bench = async () => (await one("select id from public.exercises where name = 'Bench Press'")).id as string;
const sets = (...list: [number, number][]) => JSON.stringify(list.map(([weight_kg, reps]) => ({ weight_kg, reps })));
const save = (who: string, entry: string, owner: string, exercise: string, json: string) =>
  as(who, () => rows("select public.save_session_exercise($1, $2, '2026-11-02', $3, null, null, null, $4::jsonb)", [entry, owner, exercise, json]));
const history = (who: string, table: string, id: string) =>
  as(who, () => rows("select id, table_name, op, changed_by, tx::text as tx from public.history_for($1, $2)", [table, id]));
const undo = (who: string, ids: unknown[]) => as(who, () => rows("select public.undo_changes($1::uuid[])", [ids]));
const setsOf = async (entry: string) =>
  (await rows("select weight_kg::float8 as kg, reps from public.sets where session_exercise_id = $1 order by set_no", [entry])).map((s) => `${s.kg}x${s.reps}`);

/** The rows one save made, which is what an undo takes back. */
const lastChange = async (who: string, table: string, id: string) => {
  const all = await history(who, table, id);
  return all.filter((h) => h.tx === all[0].tx);
};

async function setup(access: "add_edit" | "full" = "add_edit", extra: Record<string, unknown> = {}) {
  const client = await newUser();
  const coach = await newUser("coach");
  await connect(client, coach, "coach", { coach_access: access, ...extra });
  return { client, coach, exercise: await bench() };
}

describe("a coach logging for a client", () => {
  it("is recorded under the coach, and the client is told each change", async () => {
    const { client, coach, exercise } = await setup();
    const entry = crypto.randomUUID();
    await save(coach, entry, client, exercise, sets([60, 8], [60, 8]));

    const [row] = await rows("select created_by, updated_by from public.session_exercises where id = $1", [entry]);
    expect(row).toEqual({ created_by: coach, updated_by: coach });
    const told = await rows("select payload ->> 'table' as t, payload ->> 'op' as op from public.notifications where user_id = $1 and type = 'coach_change' order by t", [client]);
    expect(told.map((n) => `${n.t}:${n.op}`)).toEqual(["session_exercises:INSERT", "sessions:INSERT", "sets:INSERT", "sets:INSERT"]);
    const linked = await rows(
      "select count(*)::int as n from public.notifications n join public.edit_history h on h.id = (n.payload ->> 'history_id')::uuid and h.tx = (n.payload ->> 'tx')::bigint where n.user_id = $1",
      [client],
    );
    expect(linked[0].n).toBe(4);
  });

  it("shows the client the whole history, and the coach only their own changes", async () => {
    const { client, coach, exercise } = await setup();
    const entry = crypto.randomUUID();
    await save(client, entry, client, exercise, sets([60, 8]));
    await save(coach, entry, client, exercise, sets([65, 8]));
    const stranger = await newUser();

    expect((await history(client, "session_exercises", entry)).map((h) => h.changed_by)).toEqual([coach, client, client]);
    expect((await history(coach, "session_exercises", entry)).map((h) => h.changed_by)).toEqual([coach]);
    expect(await history(stranger, "session_exercises", entry)).toEqual([]);

    await rows("update public.connections set status = 'revoked' where owner_id = $1", [client]);
    expect(await history(coach, "session_exercises", entry)).toEqual([]);
  });

  it("can put a meal photo in the client's folder only while allowed to edit meals", async () => {
    const withMeals = await setup("add_edit", { share_meals: true });
    const withoutMeals = await setup();
    const friend = await newUser();
    await connect(withMeals.client, friend, "friend", { share_meals: true });
    const put = (who: string, owner: string) =>
      as(who, () => rows("insert into storage.objects (bucket_id, name) values ('meal-photos', $1)", [`${owner}/x.jpg`]));

    await expect(put(withMeals.coach, withMeals.client)).resolves.toBeDefined();
    await expect(put(withoutMeals.coach, withoutMeals.client)).rejects.toThrow(/row-level security/);
    await expect(put(friend, withMeals.client)).rejects.toThrow(/row-level security/);
    await expect(as(withMeals.coach, () => rows("insert into storage.objects (bucket_id, name) values ('meal-photos', 'not-a-uuid/x.jpg')"))).rejects.toThrow(/row-level security/);
  });
});

describe("undoing a coach's change", () => {
  it("puts an edited set back, and the coach isn't told about the undo", async () => {
    const { client, coach, exercise } = await setup();
    const entry = crypto.randomUUID();
    await save(client, entry, client, exercise, sets([60, 8], [60, 8]));
    await save(coach, entry, client, exercise, sets([60, 8], [65, 8]));

    const change = await lastChange(client, "session_exercises", entry);
    expect(change.every((h) => h.changed_by === coach)).toBe(true);
    await undo(client, change.map((h) => h.id));
    expect(await setsOf(entry)).toEqual(["60x8", "60x8"]);
    expect((await history(client, "session_exercises", entry))[0].changed_by).toBe(client);
    expect(await rows("select id from public.notifications where user_id = $1", [coach])).toEqual([]);
  });

  it("takes away what a coach added", async () => {
    const { client, coach, exercise } = await setup();
    const entry = crypto.randomUUID();
    await save(coach, entry, client, exercise, sets([60, 8], [65, 8]));
    await undo(client, (await lastChange(client, "session_exercises", entry)).map((h) => h.id));
    expect(await rows("select id from public.session_exercises where id = $1", [entry])).toEqual([]);
  });

  it("restores an exercise a coach deleted, with its sets", async () => {
    const { client, coach, exercise } = await setup("full");
    const entry = crypto.randomUUID();
    await save(client, entry, client, exercise, sets([60, 8], [65, 6]));
    await as(coach, () => rows("delete from public.session_exercises where id = $1", [entry]));
    expect(await setsOf(entry)).toEqual([]);

    await undo(client, (await lastChange(client, "session_exercises", entry)).map((h) => h.id));
    expect(await setsOf(entry)).toEqual(["60x8", "65x6"]);
  });

  it("brings the sets back even when only the exercise's own change is undone", async () => {
    const { client, coach, exercise } = await setup("full");
    const entry = crypto.randomUUID();
    await save(client, entry, client, exercise, sets([60, 8], [65, 6]));
    await as(coach, () => rows("delete from public.session_exercises where id = $1", [entry]));

    const told = await rows("select payload ->> 'table' as t from public.notifications where user_id = $1 and payload ->> 'op' = 'DELETE' order by t", [client]);
    expect(told.map((n) => n.t)).toEqual(["session_exercises", "sets", "sets"]);

    const own = (await lastChange(client, "session_exercises", entry)).filter((h) => h.table_name === "session_exercises");
    await undo(client, own.map((h) => h.id));
    expect(await setsOf(entry)).toEqual(["60x8", "65x6"]);
  });

  it("restores a meal a coach deleted, and changes back an edited one", async () => {
    const { client, coach } = await setup("full", { share_meals: true });
    const [{ id: meal }] = await as(client, () => rows("select public.save_meal($1, '2026-11-02', 'morning', 'Oats', null, null) as id", [client]));
    await as(coach, () => rows("select public.save_meal($1, '2026-11-02', 'morning', 'Eggs', null, null)", [client]));
    await undo(client, (await lastChange(client, "meals", meal as string)).map((h) => h.id));
    expect((await one("select description from public.meals where id = $1", [meal])).description).toBe("Oats");

    await as(coach, () => rows("select public.soft_delete_entry('meals', $1)", [meal]));
    await undo(client, (await lastChange(client, "meals", meal as string)).map((h) => h.id));
    expect((await one("select deleted_at from public.meals where id = $1", [meal])).deleted_at).toBeNull();
  });

  it("refuses once something has changed since", async () => {
    const { client, coach, exercise } = await setup();
    const entry = crypto.randomUUID();
    await save(client, entry, client, exercise, sets([60, 8]));
    await save(coach, entry, client, exercise, sets([65, 8]));
    const change = await lastChange(client, "session_exercises", entry);
    await save(client, entry, client, exercise, sets([70, 8]));

    await expect(undo(client, change.map((h) => h.id))).rejects.toThrow(/changed_since/);
    expect(await setsOf(entry)).toEqual(["70x8"]);
  });

  it("is for the owner only", async () => {
    const { client, coach, exercise } = await setup();
    const stranger = await newUser();
    const entry = crypto.randomUUID();
    await save(client, entry, client, exercise, sets([60, 8]));
    await save(coach, entry, client, exercise, sets([65, 8]));
    const ids = (await lastChange(client, "session_exercises", entry)).map((h) => h.id);

    await expect(undo(coach, ids)).rejects.toThrow(/not allowed/);
    await expect(undo(stranger, ids)).rejects.toThrow(/not allowed/);
    await expect(undo(client, [...ids, crypto.randomUUID()])).rejects.toThrow(/not allowed/);
    expect(await setsOf(entry)).toEqual(["65x8"]);
  });
});

describe("notes from a coach", () => {
  it("reach the client, except private ones, and only reminders can be ticked", async () => {
    const { client, coach } = await setup();
    const note = (kind: string, body: string) =>
      as(coach, () => one("insert into public.coach_notes (coach_id, user_id, kind, body) values ($1, $2, $3, $4) returning id", [coach, client, kind, body]));
    const reminder = (await note("reminder", "Film your squat")).id;
    const goal = (await note("goal", "Bench 80 kg")).id;
    await note("private", "Knee is a worry");

    await as(client, async () => {
      expect((await rows("select kind from public.coach_notes order by kind")).map((n) => n.kind)).toEqual(["reminder", "goal"]);
      await rows("select public.set_reminder_done($1, true)", [reminder]);
      await expect(rows("select public.set_reminder_done($1, true)", [goal])).rejects.toThrow(/not allowed/);
    });
    expect((await one("select done_at from public.coach_notes where id = $1", [reminder])).done_at).not.toBeNull();
    expect((await rows("select id from public.notifications where user_id = $1 and type = 'coach_note'", [client])).length).toBe(2);
  });
});
