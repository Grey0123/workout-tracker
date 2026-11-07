/**
 * What M5 adds to the rules: goals with a target, evaluations, body weight and
 * workout videos, and who may see and write each.
 */
import { describe, expect, it } from "vitest";
import { openDb } from "./harness";

const { as, rows, newUser, connect } = await openDb();
const one = async (sql: string, params: unknown[] = []) => (await rows(sql, params))[0];
const bench = async () => (await one("select id from public.exercises where name = 'Bench Press'")).id as string;
const session = async (owner: string) => (await one("insert into public.sessions (user_id, date, created_by) values ($1, '2026-11-02', $1) returning id", [owner])).id as string;

describe("goals", () => {
  it("can name an exercise and a target, but only together, and only on a goal", async () => {
    const client = await newUser();
    const coach = await newUser("coach");
    await connect(client, coach, "coach");
    const exercise = await bench();
    const note = (kind: string, ex: string | null, kg: number | null) =>
      as(coach, () =>
        rows("insert into public.coach_notes (coach_id, user_id, kind, body, goal_exercise_id, goal_target_kg) values ($1, $2, $3, 'x', $4, $5)", [coach, client, kind, ex, kg]),
      );
    await expect(note("goal", exercise, 80)).resolves.toBeDefined();
    await expect(note("goal", null, null)).resolves.toBeDefined();
    await expect(note("goal", exercise, null)).rejects.toThrow(/goal_pair/);
    await expect(note("reminder", exercise, 80)).rejects.toThrow(/goal_fields/);
  });
});

describe("evaluations", () => {
  it("are written by the coach for their own client, and read by the client", async () => {
    const client = await newUser();
    const coach = await newUser("coach");
    const other = await newUser("coach");
    await connect(client, coach, "coach");
    const write = (who: string) =>
      as(who, () =>
        rows(
          `insert into public.evaluations (coach_id, user_id, period_start, period_end, feedback, rating_training, next_goals)
           values ($1, $2, '2026-10-05', '2026-11-01', 'Good month', 4, array['Bench e1RM to 76 kg']) returning id`,
          [who, client],
        ),
      );
    await write(coach);
    await expect(write(other)).rejects.toThrow(/row-level security/);
    await as(client, async () => {
      expect(await rows("select feedback, next_goals from public.evaluations")).toEqual([{ feedback: "Good month", next_goals: ["Bench e1RM to 76 kg"] }]);
    });
    expect((await rows("select id from public.notifications where user_id = $1 and type = 'evaluation'", [client])).length).toBe(1);
  });
});

describe("body weight", () => {
  it("is the owner's to write, and seen by others only when ticked", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const id = await connect(owner, friend, "friend");
    await as(owner, () => rows("insert into public.bodyweight (user_id, date, kg) values ($1, '2026-11-02', 86)", [owner]));
    await as(friend, async () => {
      expect(await rows("select kg from public.bodyweight where user_id = $1", [owner])).toEqual([]);
      await expect(rows("insert into public.bodyweight (user_id, date, kg) values ($1, '2026-11-03', 50)", [owner])).rejects.toThrow(/row-level security/);
    });
    await rows("update public.connections set share_bodyweight = true where id = $1", [id]);
    await as(friend, async () => expect((await rows("select kg::float8 as kg from public.bodyweight where user_id = $1", [owner]))[0].kg).toBe(86));
  });
});

describe("workout videos", () => {
  const add = (who: string, owner: string, sessionId: string, path: string) =>
    as(who, () => rows("insert into public.workout_media (user_id, session_id, path, duration_s) values ($1, $2, $3, 30) returning id", [owner, sessionId, path]));

  it("belong to their owner, in their own session and folder", async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const mine = await session(owner);
    const theirs = await session(stranger);
    await expect(add(owner, owner, mine, `${owner}/a.mp4`)).resolves.toBeDefined();
    await expect(add(owner, owner, theirs, `${owner}/b.mp4`)).rejects.toThrow(/row-level security/);
    await expect(add(owner, owner, mine, `${stranger}/c.mp4`)).rejects.toThrow(/own_folder/);
    await expect(add(stranger, owner, mine, `${owner}/d.mp4`)).rejects.toThrow(/row-level security/);
  });

  it("are seen by people the owner shares workouts with, and can't be longer than a minute", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const id = await connect(owner, friend, "friend");
    const s = await session(owner);
    await add(owner, owner, s, `${owner}/a.mp4`);
    await expect(as(owner, () => rows("insert into public.workout_media (user_id, session_id, path, duration_s) values ($1, $2, $3, 61)", [owner, s, `${owner}/b.mp4`]))).rejects.toThrow();

    await as(friend, async () => expect(await rows("select id from public.workout_media where user_id = $1", [owner])).toHaveLength(1));
    await rows("update public.connections set share_workouts = false where id = $1", [id]);
    await as(friend, async () => expect(await rows("select id from public.workout_media where user_id = $1", [owner])).toEqual([]));
  });
});
