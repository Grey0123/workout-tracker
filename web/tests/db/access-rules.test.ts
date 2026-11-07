/**
 * The PRD's access rules (sections 4 and 9), run against the real migration on
 * PGlite, an in-process Postgres. These need no Docker and no Supabase project.
 * The stubs below stand in for the parts of Supabase the migration relies on.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "supabase", "migrations");

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;

  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;

  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean,
                                file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1 : cardinality(string_to_array(name, '/')) - 1] $$;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`;

let db: PGlite;
let seq = 0;

type Row = Record<string, unknown>;

async function asRole<T>(role: string, id: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

const as = <T>(user: string, fn: () => Promise<T>) => asRole("authenticated", user, fn);
const rows = async (sql: string, params: unknown[] = []) => (await db.query<Row>(sql, params)).rows;
const changed = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).affectedRows ?? 0;

async function newUser(type: "user" | "coach" = "user"): Promise<string> {
  const n = ++seq;
  const meta = { username: `u${n}_${type}`, display_name: `User ${n}`, account_type: type, coach_disclaimer_accepted: type === "coach" };
  const [row] = await rows("insert into auth.users (raw_user_meta_data) values ($1) returning id", [JSON.stringify(meta)]);
  return row.id as string;
}

async function connect(owner: string, viewer: string, kind: "friend" | "coach", extra: Record<string, unknown> = {}) {
  const cols = ["owner_id", "viewer_id", "kind", "status", ...Object.keys(extra)];
  const vals = [owner, viewer, kind, "active", ...Object.values(extra)];
  const [row] = await rows(
    `insert into public.connections (${cols.join(", ")}) values (${vals.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    vals,
  );
  return row.id as string;
}

/** A session with one exercise and one set, written directly as trusted server work. */
async function workout(owner: string) {
  const [exercise] = await rows("select id from public.exercises where name = 'Bench Press'");
  const [session] = await rows("insert into public.sessions (user_id, date, created_by) values ($1, '2026-10-27', $1) returning id", [owner]);
  const [entry] = await rows("insert into public.session_exercises (session_id, exercise_id) values ($1, $2) returning id", [session.id, exercise.id]);
  const [set] = await rows("insert into public.sets (session_exercise_id, set_no, weight_kg, reps) values ($1, 1, 60, 8) returning id", [entry.id]);
  return { session: session.id as string, entry: entry.id as string, set: set.id as string, exercise: exercise.id as string };
}

async function meal(owner: string, date = "2026-10-27") {
  const [row] = await rows("insert into public.meals (user_id, date, slot, description) values ($1, $2, 'morning', 'Oats') returning id", [owner, date]);
  return row.id as string;
}

const countSessions = (id: string) => rows("select id from public.sessions where id = $1", [id]).then(r => r.length);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
});

describe("baseline", () => {
  it("has row-level security on every public table", async () => {
    const open = await rows("select tablename from pg_tables where schemaname = 'public' and not rowsecurity");
    expect(open).toEqual([]);
  });

  it("gives signed-out visitors nothing", async () => {
    const tables = await rows("select tablename from pg_tables where schemaname = 'public'");
    expect(tables.length).toBeGreaterThan(10);
    for (const { tablename } of tables) {
      await expect(asRole("anon", "", () => rows(`select * from public.${tablename}`))).rejects.toThrow(/permission denied/);
    }
  });

  it("creates a profile at sign-up and requires coaches to accept the notice", async () => {
    const coach = await newUser("coach");
    const [profile] = await rows("select account_type, coach_disclaimer_accepted_at from public.profiles where id = $1", [coach]);
    expect(profile.account_type).toBe("coach");
    expect(profile.coach_disclaimer_accepted_at).not.toBeNull();

    const meta = { username: "no_notice", display_name: "No Notice", account_type: "coach" };
    await expect(rows("insert into auth.users (raw_user_meta_data) values ($1)", [JSON.stringify(meta)])).rejects.toThrow(/self-declared/);
  });

  it("doesn't let an account turn itself into a coach", async () => {
    const user = await newUser();
    await expect(as(user, () => rows("update public.profiles set account_type = 'coach' where id = $1", [user]))).rejects.toThrow(/permission denied/);
  });
});

describe("strangers", () => {
  it("can't read or change anything of another person's", async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const w = await workout(owner);
    const m = await meal(owner);

    await as(stranger, async () => {
      expect(await countSessions(w.session)).toBe(0);
      expect(await rows("select id from public.sets where id = $1", [w.set])).toEqual([]);
      expect(await rows("select id from public.meals where id = $1", [m])).toEqual([]);
      expect(await rows("select id from public.profiles where id = $1", [owner])).toEqual([]);
      expect(await changed("update public.sets set reps = 1 where id = $1", [w.set])).toBe(0);
      expect(await changed("delete from public.sessions where id = $1", [w.session])).toBe(0);
      await expect(rows("insert into public.sessions (user_id, date) values ($1, '2026-10-28')", [owner])).rejects.toThrow(/row-level security/);
      await expect(rows("select public.soft_delete_entry('sessions', $1)", [w.session])).rejects.toThrow(/not allowed/);
    });
  });
});

describe("friends", () => {
  it("see workouts only by default, and more only once ticked on", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const id = await connect(owner, friend, "friend");
    const w = await workout(owner);
    const m = await meal(owner);
    await rows("insert into public.bodyweight (user_id, date, kg) values ($1, '2026-10-27', 74)", [owner]);

    await as(friend, async () => {
      expect(await countSessions(w.session)).toBe(1);
      expect(await rows("select id from public.sets where id = $1", [w.set])).toHaveLength(1);
      expect(await rows("select id from public.meals where id = $1", [m])).toEqual([]);
      expect(await rows("select id from public.bodyweight where user_id = $1", [owner])).toEqual([]);
    });

    await rows("update public.connections set share_meals = true where id = $1", [id]);
    await as(friend, async () => {
      expect(await rows("select id from public.meals where id = $1", [m])).toHaveLength(1);
    });
  });

  it("can't write, even to what they can see", async () => {
    const owner = await newUser();
    const friend = await newUser();
    await connect(owner, friend, "friend", { share_meals: true });
    const w = await workout(owner);
    const m = await meal(owner);

    await as(friend, async () => {
      expect(await changed("update public.sessions set notes = 'x' where id = $1", [w.session])).toBe(0);
      expect(await changed("update public.sets set reps = 1 where id = $1", [w.set])).toBe(0);
      expect(await changed("update public.meals set description = 'x' where id = $1", [m])).toBe(0);
      await expect(rows("insert into public.sessions (user_id, date) values ($1, '2026-10-28')", [owner])).rejects.toThrow(/row-level security/);
      await expect(rows("insert into public.sets (session_exercise_id, set_no) values ($1, 2)", [w.entry])).rejects.toThrow(/row-level security/);
    });
  });

  it("can't see coach notes or evaluations", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const coach = await newUser("coach");
    await connect(owner, friend, "friend");
    await connect(owner, coach, "coach");
    await rows("insert into public.coach_notes (coach_id, user_id, kind, body) values ($1, $2, 'goal', 'Bench 80 kg')", [coach, owner]);
    await rows("insert into public.evaluations (coach_id, user_id, period_start, period_end, feedback) values ($1, $2, '2026-10-01', '2026-10-27', 'Good')", [coach, owner]);

    await as(friend, async () => {
      expect(await rows("select id from public.coach_notes where user_id = $1", [owner])).toEqual([]);
      expect(await rows("select id from public.evaluations where user_id = $1", [owner])).toEqual([]);
    });
  });
});

describe("coach with Add & edit", () => {
  it("can add and edit, and the client is told exactly what changed", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    await connect(owner, coach, "coach");
    const w = await workout(owner);

    await as(coach, async () => {
      expect(await changed("update public.sets set weight_kg = 65 where id = $1", [w.set])).toBe(1);
      const [added] = await rows("insert into public.sessions (user_id, date) values ($1, '2026-10-29') returning created_by", [owner]);
      expect(added.created_by).toBe(coach);
    });

    const [set] = await rows("select updated_by from public.sets where id = $1", [w.set]);
    expect(set.updated_by).toBe(coach);

    const [history] = await rows("select owner_id, changed_by, before, after from public.edit_history where row_id = $1", [w.set]);
    expect(history.owner_id).toBe(owner);
    expect(history.changed_by).toBe(coach);
    expect(Number((history.before as Row).weight_kg)).toBe(60);
    expect(Number((history.after as Row).weight_kg)).toBe(65);

    const notes = await as(owner, () => rows("select type, actor_id, payload from public.notifications where user_id = $1", [owner]));
    const change = notes.find(n => (n.payload as Row).row_id === w.set);
    expect(change?.type).toBe("coach_change");
    expect(change?.actor_id).toBe(coach);
    expect(Number(((change?.payload as Row).after as Row).weight_kg)).toBe(65);
  });

  it("can't delete anything", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    await connect(owner, coach, "coach", { share_meals: true });
    const w = await workout(owner);
    const m = await meal(owner);

    await as(coach, async () => {
      expect(await changed("delete from public.sessions where id = $1", [w.session])).toBe(0);
      expect(await changed("delete from public.session_exercises where id = $1", [w.entry])).toBe(0);
      expect(await changed("delete from public.sets where id = $1", [w.set])).toBe(0);
      expect(await changed("delete from public.meals where id = $1", [m])).toBe(0);
      await expect(rows("select public.soft_delete_entry('sessions', $1)", [w.session])).rejects.toThrow(/not allowed/);
      await expect(rows("select public.soft_delete_entry('meals', $1)", [m])).rejects.toThrow(/not allowed/);
      await expect(rows("update public.sessions set deleted_at = now() where id = $1", [w.session])).rejects.toThrow();
      await expect(rows("update public.sessions set deleted_by = $1 where id = $2", [owner, w.session])).rejects.toThrow(/soft_delete_entry/);
    });
  });

  it("can only touch meals the client shares", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    const id = await connect(owner, coach, "coach");
    const m = await meal(owner);

    await as(coach, async () => {
      expect(await rows("select id from public.meals where id = $1", [m])).toEqual([]);
      expect(await changed("update public.meals set description = 'x' where id = $1", [m])).toBe(0);
      await expect(rows("insert into public.meals (user_id, date, slot) values ($1, '2026-10-29', 'evening')", [owner])).rejects.toThrow(/row-level security/);
    });

    await rows("update public.connections set share_meals = true where id = $1", [id]);
    await as(coach, async () => {
      expect(await changed("update public.meals set description = 'Eggs' where id = $1", [m])).toBe(1);
    });
  });

  it("can't raise their own access, change sharing, or pose as the client", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    const id = await connect(owner, coach, "coach");
    const w = await workout(owner);

    await as(coach, async () => {
      await expect(rows("update public.connections set coach_access = 'full' where id = $1", [id])).rejects.toThrow(/permission denied/);
      await expect(rows("update public.connections set share_meals = true where id = $1", [id])).rejects.toThrow(/permission denied/);
      await rows("update public.sessions set updated_by = $1, created_by = $1 where id = $2", [owner, w.session]);
      await expect(rows("update public.sessions set user_id = $1 where id = $2", [coach, w.session])).rejects.toThrow();
    });

    const [session] = await rows("select created_by, updated_by from public.sessions where id = $1", [w.session]);
    expect(session.updated_by).toBe(coach);
    expect(session.created_by).toBe(owner);
  });

  it("can't reach a second client through the first", async () => {
    const owner = await newUser();
    const other = await newUser();
    const coach = await newUser("coach");
    await connect(owner, coach, "coach");
    const w = await workout(other);

    await as(coach, async () => {
      expect(await countSessions(w.session)).toBe(0);
      expect(await changed("update public.sets set reps = 1 where id = $1", [w.set])).toBe(0);
    });
  });
});

describe("coach with Full control", () => {
  it("soft deletes, the client is told and can restore", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    const friend = await newUser();
    await connect(owner, coach, "coach", { coach_access: "full" });
    await connect(owner, friend, "friend");
    const w = await workout(owner);

    await as(coach, () => rows("select public.soft_delete_entry('sessions', $1)", [w.session]));

    const [session] = await rows("select deleted_at, deleted_by from public.sessions where id = $1", [w.session]);
    expect(session.deleted_at).not.toBeNull();
    expect(session.deleted_by).toBe(coach);

    await as(friend, async () => {
      expect(await countSessions(w.session)).toBe(0);
      expect(await rows("select id from public.sets where id = $1", [w.set])).toEqual([]);
    });
    await as(coach, async () => expect(await countSessions(w.session)).toBe(0));
    await as(owner, async () => expect(await countSessions(w.session)).toBe(1));

    const notes = await rows("select payload from public.notifications where user_id = $1", [owner]);
    expect(notes.some(n => (n.payload as Row).row_id === w.session)).toBe(true);

    await expect(as(coach, () => rows("select public.restore_entry('sessions', $1)", [w.session]))).rejects.toThrow(/not allowed/);
    await as(owner, () => rows("select public.restore_entry('sessions', $1)", [w.session]));
    await as(friend, async () => expect(await countSessions(w.session)).toBe(1));
  });

  it("keeps the values of sets lost when an exercise is deleted", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    await connect(owner, coach, "coach", { coach_access: "full" });
    const w = await workout(owner);

    await as(coach, async () => {
      expect(await changed("delete from public.session_exercises where id = $1", [w.entry])).toBe(1);
    });

    const [history] = await rows("select op, changed_by, before from public.edit_history where row_id = $1", [w.set]);
    expect(history.op).toBe("DELETE");
    expect(history.changed_by).toBe(coach);
    expect(Number((history.before as Row).weight_kg)).toBe(60);
  });
});

describe("removing a coach", () => {
  it("ends access immediately, and sent notes stay with the client", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    const id = await connect(owner, coach, "coach", { share_meals: true });
    const w = await workout(owner);
    const m = await meal(owner);
    await rows("insert into public.coach_notes (coach_id, user_id, kind, body) values ($1, $2, 'private', 'Elbows flare')", [coach, owner]);
    await rows("insert into public.coach_notes (coach_id, user_id, kind, body) values ($1, $2, 'reminder', 'Film your squat')", [coach, owner]);
    await as(coach, () => rows("update public.sets set reps = 9 where id = $1", [w.set]));

    await rows("update public.connections set status = 'revoked' where id = $1", [id]);

    await as(coach, async () => {
      expect(await countSessions(w.session)).toBe(0);
      expect(await rows("select id from public.meals where id = $1", [m])).toEqual([]);
      expect(await rows("select id from public.coach_notes where user_id = $1", [owner])).toEqual([]);
      expect(await rows("select id from public.edit_history where owner_id = $1", [owner])).toEqual([]);
      expect(await rows("select id from public.profiles where id = $1", [owner])).toEqual([]);
      expect(await changed("update public.sets set reps = 1 where id = $1", [w.set])).toBe(0);
    });

    await as(owner, async () => {
      const notes = await rows("select kind from public.coach_notes where user_id = $1", [owner]);
      expect(notes.map(n => n.kind)).toEqual(["reminder"]);
      expect(await rows("select id from public.profiles where id = $1", [coach])).toHaveLength(1);
      expect(await rows("select id from public.edit_history where row_id = $1", [w.set])).toHaveLength(1);
    });
  });

  it("allows one active coach at a time", async () => {
    const owner = await newUser();
    await connect(owner, await newUser("coach"), "coach");
    await expect(connect(owner, await newUser("coach"), "coach")).rejects.toThrow(/connections_one_coach/);
  });
});

describe("coach notes", () => {
  it("keeps private notes from the client, and lets them tick reminders only", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    await connect(owner, coach, "coach");

    const [priv, reminder] = await as(coach, async () => [
      (await rows("insert into public.coach_notes (coach_id, user_id, kind, body) values ($1, $2, 'private', 'Elbows flare') returning id", [coach, owner]))[0].id,
      (await rows("insert into public.coach_notes (coach_id, user_id, kind, body) values ($1, $2, 'reminder', 'Film your squat') returning id", [coach, owner]))[0].id,
    ]);

    await as(owner, async () => {
      const notes = await rows("select id from public.coach_notes where user_id = $1", [owner]);
      expect(notes.map(n => n.id)).toEqual([reminder]);
      expect(await changed("update public.coach_notes set body = 'x' where id = $1", [reminder])).toBe(0);
      await rows("select public.set_reminder_done($1, true)", [reminder]);
      await expect(rows("select public.set_reminder_done($1, true)", [priv])).rejects.toThrow(/not allowed/);
    });

    const notified = await rows("select payload from public.notifications where user_id = $1", [owner]);
    expect(notified.map(n => (n.payload as Row).row_id)).toEqual([reminder]);
    const [done] = await rows("select done_at from public.coach_notes where id = $1", [reminder]);
    expect(done.done_at).not.toBeNull();
  });

  it("only lets a coach write about their own clients, under their own name", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    const otherCoach = await newUser("coach");
    await connect(owner, coach, "coach");

    await as(otherCoach, async () => {
      await expect(rows("insert into public.coach_notes (coach_id, user_id, kind, body) values ($1, $2, 'goal', 'x')", [otherCoach, owner])).rejects.toThrow(/row-level security/);
      await expect(rows("insert into public.coach_notes (coach_id, user_id, kind, body) values ($1, $2, 'goal', 'x')", [coach, owner])).rejects.toThrow(/row-level security/);
    });
  });
});

describe("edit history and notifications", () => {
  it("can't be written or rewritten directly", async () => {
    const owner = await newUser();
    await as(owner, async () => {
      await expect(rows("insert into public.edit_history (owner_id, table_name, row_id, op) values ($1, 'sets', gen_random_uuid(), 'UPDATE')", [owner])).rejects.toThrow(/permission denied/);
      await expect(rows("delete from public.edit_history where owner_id = $1", [owner])).rejects.toThrow(/permission denied/);
      await expect(rows("insert into public.notifications (user_id, type) values ($1, 'x')", [owner])).rejects.toThrow(/permission denied/);
      await expect(rows("update public.notifications set payload = '{}' where user_id = $1", [owner])).rejects.toThrow(/permission denied/);
      await rows("update public.notifications set read_at = now() where user_id = $1", [owner]);
    });
  });

  it("doesn't notify anyone about their own edits", async () => {
    const owner = await newUser();
    const w = await workout(owner);
    await as(owner, async () => {
      await rows("update public.sets set reps = 10 where id = $1", [w.set]);
      expect(await rows("select id from public.edit_history where row_id = $1", [w.set])).toHaveLength(1);
      expect(await rows("select id from public.notifications where user_id = $1", [owner])).toEqual([]);
    });
  });
});

describe("custom exercises", () => {
  const custom = (me: string) =>
    as(me, async () => (await rows(
      `insert into public.exercises (name, category, kind, inputs, is_custom, created_by)
       values ('Sandbag Carry', 'Full body & conditioning', 'custom', array['weight_kg', 'distance_km'], true, $1) returning id`, [me]))[0].id as string);

  it("are private to their creator and visible to people who can see their workouts", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const stranger = await newUser();
    await connect(owner, friend, "friend");
    const id = await custom(owner);

    await as(friend, async () => expect(await rows("select id from public.exercises where id = $1", [id])).toHaveLength(1));
    await as(stranger, async () => expect(await rows("select id from public.exercises where id = $1", [id])).toEqual([]));
  });

  it("can't be attached to your log to expose someone else's", async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const id = await custom(owner);
    const w = await workout(stranger);

    await as(stranger, async () => {
      await expect(rows("insert into public.session_exercises (session_id, exercise_id) values ($1, $2)", [w.session, id])).rejects.toThrow(/row-level security/);
      expect(await rows("select id from public.exercises where id = $1", [id])).toEqual([]);
    });
  });

  it("from a coach can be used in the client's log, and stay readable afterwards", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    const conn = await connect(owner, coach, "coach");
    const id = await custom(coach);
    const w = await workout(owner);

    await as(coach, () => rows("insert into public.session_exercises (session_id, exercise_id) values ($1, $2)", [w.session, id]));
    await rows("update public.connections set status = 'revoked' where id = $1", [conn]);
    await as(owner, async () => expect(await rows("select id from public.exercises where id = $1", [id])).toHaveLength(1));
  });

  it("can't be made to look built in", async () => {
    const owner = await newUser();
    await as(owner, async () => {
      await expect(rows("insert into public.exercises (name, category, kind, inputs) values ('Fake', 'Chest', 'weighted', array['reps'])")).rejects.toThrow();
    });
  });
});

describe("exercise library", () => {
  it("covers the PRD's 15 categories, and every kind asks for something", async () => {
    const categories = await rows("select distinct category from public.exercises where not is_custom");
    expect(categories).toHaveLength(15);
    expect(await rows("select name from public.exercises where not is_custom and cardinality(inputs) = 0")).toEqual([]);
  });

  it("lists secondary muscles only from those categories", async () => {
    const bad = await rows(`
      select e.name, m from public.exercises e, unnest(e.secondary_muscles) m
      where m not in (select category from public.exercises)`);
    expect(bad).toEqual([]);
  });

  it("includes every name v1 has logged", async () => {
    const names = ["Assisted Pull Up", "Bench Press", "Bicep Curl", "Chest Press", "Lat Pulldown", "Lateral Raise", "Lunge", "Pec Deck Fly",
      "Plank", "Pull Up", "Reverse Pec Deck Fly", "Seated Row", "Shoulder Press", "Squat", "Treadmill", "Tricep Pushdown"];
    const found = await rows("select name from public.exercises where not is_custom and name = any($1)", [names]);
    expect(found).toHaveLength(names.length);
  });

  it("marks only the assisted exercises as assisted", async () => {
    const assisted = await rows("select name from public.exercises where assisted order by name");
    expect(assisted.map((r) => r.name)).toEqual(["Assisted Dip", "Assisted Pull Up"]);
  });

  it("won't mark an exercise assisted without a weight to log", async () => {
    const owner = await newUser();
    await as(owner, async () => {
      await expect(rows(
        `insert into public.exercises (name, category, kind, inputs, assisted, is_custom, created_by)
         values ('Helped Hang', 'Back', 'timed', array['duration_s'], true, true, $1)`, [owner])).rejects.toThrow(/assisted_has_weight/);
    });
  });

  it("has one Seated Row, with no separate machine rows", async () => {
    const rowsFound = await rows("select name from public.exercises where not is_custom and name in ('Seated Row', 'Seated Row Machine', 'Low Row')");
    expect(rowsFound).toEqual([{ name: "Seated Row" }]);
  });

  it("folds logged machine rows into Seated Row, keeping the machine in the variant", async () => {
    // A database that already holds rows logged before the merge.
    const fresh = new PGlite();
    await fresh.exec(SUPABASE_STUBS);
    const files = readdirSync(MIGRATIONS).sort();
    const merge = files.findIndex((f) => f.includes("rows_and_assistance"));
    for (const file of files.slice(0, merge)) await fresh.exec(readFileSync(join(MIGRATIONS, file), "utf8"));

    const id = (name: string) => `(select id from public.exercises where name = '${name}' and not is_custom)`;
    await fresh.exec(`
      insert into auth.users (id, raw_user_meta_data) values ('11111111-1111-4111-8111-111111111111', '{"username":"merge_check","display_name":"M"}');
      insert into public.sessions (id, user_id, date) values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', '2026-07-01');
      insert into public.session_exercises (session_id, exercise_id, position, variant) values
        ('22222222-2222-4222-8222-222222222222', ${id("Seated Row")}, 0, null),
        ('22222222-2222-4222-8222-222222222222', ${id("Seated Row Machine")}, 1, 'Wide grip'),
        ('22222222-2222-4222-8222-222222222222', ${id("Low Row")}, 2, null);`);
    for (const file of files.slice(merge)) await fresh.exec(readFileSync(join(MIGRATIONS, file), "utf8"));

    const merged = (await fresh.query<Row>(`
      select e.name, se.variant from public.session_exercises se join public.exercises e on e.id = se.exercise_id order by se.position`)).rows;
    expect(merged).toEqual([
      { name: "Seated Row", variant: null },
      { name: "Seated Row", variant: "Machine · Wide grip" },
      { name: "Seated Row", variant: "Low row machine" },
    ]);
    await fresh.close();
  });

  it("is readable by everyone signed in and can't be changed", async () => {
    const user = await newUser();
    await as(user, async () => {
      const [bench] = await rows("select id from public.exercises where name = 'Bench Press'");
      expect(bench).toBeDefined();
      expect(await changed("update public.exercises set name = 'Mine' where id = $1", [bench.id])).toBe(0);
      expect(await changed("delete from public.exercises where id = $1", [bench.id])).toBe(0);
    });
  });
});

describe("saving an exercise", () => {
  const bench = async () => (await rows("select id from public.exercises where name = 'Bench Press'"))[0].id as string;
  const id = () => crypto.randomUUID();
  const sets = (...list: [number, number][]) => JSON.stringify(list.map(([weight_kg, reps]) => ({ weight_kg, reps })));
  const save = (entry: string, owner: string, exercise: string, json: string, date = "2026-11-01") =>
    rows("select public.save_session_exercise($1, $2, $3, $4, null, null, null, $5::jsonb)", [entry, owner, date, exercise, json]);
  const setsOf = (entry: string) =>
    rows("select id, set_no, weight_kg::float8 as kg, reps from public.sets where session_exercise_id = $1 order by set_no", [entry]);

  it("starts one session for the day and reuses it", async () => {
    const owner = await newUser();
    const exercise = await bench();
    const first = id();
    const second = id();
    await as(owner, async () => {
      await save(first, owner, exercise, sets([60, 8], [65, 8]));
      await save(second, owner, exercise, sets([70, 5]));
      const sessions = await rows("select id, created_by from public.sessions where user_id = $1", [owner]);
      expect(sessions).toEqual([expect.objectContaining({ created_by: owner })]);
      const entries = await rows("select id, position from public.session_exercises where session_id = $1 order by position", [sessions[0].id]);
      expect(entries).toEqual([{ id: first, position: 0 }, { id: second, position: 1 }]);
      expect(await setsOf(first)).toEqual([
        expect.objectContaining({ set_no: 1, kg: 60, reps: 8 }),
        expect.objectContaining({ set_no: 2, kg: 65, reps: 8 }),
      ]);
    });
  });

  it("doesn't reuse a deleted session", async () => {
    const owner = await newUser();
    const exercise = await bench();
    await as(owner, async () => {
      await save(id(), owner, exercise, sets([60, 8]));
      const [old] = await rows("select id from public.sessions where user_id = $1", [owner]);
      await rows("select public.soft_delete_entry('sessions', $1)", [old.id]);
      await save(id(), owner, exercise, sets([60, 8]));
      expect(await rows("select id from public.sessions where user_id = $1 and deleted_at is null and id <> $2", [owner, old.id])).toHaveLength(1);
    });
  });

  it("changes only what differs on an edit, so history stays readable", async () => {
    const owner = await newUser();
    const exercise = await bench();
    const entry = id();
    await as(owner, () => save(entry, owner, exercise, sets([60, 8], [65, 8], [70, 8])));
    const before = await setsOf(entry);

    await as(owner, () => save(entry, owner, exercise, sets([60, 8], [67.5, 8])));
    const after = await setsOf(entry);
    expect(after.map((s) => s.kg)).toEqual([60, 67.5]);
    expect(after.map((s) => s.id)).toEqual(before.slice(0, 2).map((s) => s.id));

    const history = await rows(
      "select row_id, op from public.edit_history where table_name = 'sets' and owner_id = $1 and op <> 'INSERT' order by op",
      [owner],
    );
    expect(history).toEqual([{ row_id: before[2].id, op: "DELETE" }, { row_id: before[1].id, op: "UPDATE" }]);
  });

  it("saves all or nothing", async () => {
    const owner = await newUser();
    const exercise = await bench();
    const entry = id();
    await as(owner, async () => {
      await expect(save(entry, owner, exercise, JSON.stringify([{ weight_kg: 60, reps: 8 }, { weight_kg: -1, reps: 8 }]))).rejects.toThrow();
      await expect(save(entry, owner, exercise, "[]")).rejects.toThrow(/at least one set/);
    });
    expect(await rows("select id from public.session_exercises where id = $1", [entry])).toEqual([]);
    expect(await rows("select id from public.sessions where user_id = $1", [owner])).toEqual([]);
  });

  it("keeps time, distance, side and a per-set tempo", async () => {
    const owner = await newUser();
    const exercise = await bench();
    const entry = id();
    const json = JSON.stringify([{ duration_s: 90, distance_km: 1.5, side: "left", tempo: "3-1-1-0", rpe: 7, rounds: 2, calories: 40 }]);
    await as(owner, () => save(entry, owner, exercise, json));
    const [set] = await rows(
      "select duration_s, distance_km::float8 as km, side, tempo, rpe::float8 as rpe, rounds, calories from public.sets where session_exercise_id = $1", [entry]);
    expect(set).toEqual({ duration_s: 90, km: 1.5, side: "left", tempo: "3-1-1-0", rpe: 7, rounds: 2, calories: 40 });
  });

  it("is refused for a stranger and for a friend", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const stranger = await newUser();
    await connect(owner, friend, "friend");
    const exercise = await bench();
    const entry = id();
    await as(owner, () => save(entry, owner, exercise, sets([60, 8])));

    for (const other of [friend, stranger]) {
      await as(other, async () => {
        await expect(save(id(), owner, exercise, sets([1, 1]))).rejects.toThrow(/row-level security/);
        await expect(save(entry, owner, exercise, sets([1, 1]))).rejects.toThrow();
      });
    }
    expect((await setsOf(entry))[0].kg).toBe(60);
  });

  it("won't take someone else's custom exercise", async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const [theirs] = await as(owner, () => rows(
      `insert into public.exercises (name, category, kind, inputs, is_custom, created_by)
       values ('Secret Move', 'Chest', 'weighted', array['weight_kg', 'reps'], true, $1) returning id`, [owner]));
    await as(stranger, async () => {
      await expect(save(id(), stranger, theirs.id as string, sets([1, 1]))).rejects.toThrow(/row-level security/);
    });
  });

  it("lets an Add & edit coach change sets but not remove them", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    await connect(owner, coach, "coach");
    const exercise = await bench();
    const entry = id();
    await as(owner, () => save(entry, owner, exercise, sets([60, 8], [65, 8])));

    await as(coach, async () => {
      await save(entry, owner, exercise, sets([62.5, 8], [65, 8], [65, 6]));
      await expect(save(entry, owner, exercise, sets([62.5, 8]))).rejects.toThrow(/remove sets/);
    });
    expect((await setsOf(entry)).map((s) => s.kg)).toEqual([62.5, 65, 65]);

    const [told] = await rows("select count(*)::int as n from public.notifications where user_id = $1 and actor_id = $2", [owner, coach]);
    expect(told.n).toBeGreaterThan(0);
  });

  it("is closed to signed-out visitors", async () => {
    await expect(asRole("anon", "", () => rows("select public.save_session_exercise(gen_random_uuid(), gen_random_uuid(), '2026-11-01', gen_random_uuid(), null, null, null, '[{}]'::jsonb)")))
      .rejects.toThrow(/permission denied/);
    await expect(asRole("anon", "", () => rows("select public.save_meal(gen_random_uuid(), '2026-11-01', 'morning', 'x', null, null)")))
      .rejects.toThrow(/permission denied/);
  });
});

describe("saving a meal", () => {
  const save = (owner: string, description: string | null, photo: string | null = null, slot = "morning") =>
    rows("select public.save_meal($1, '2026-11-01', $2, $3, null, $4) as id", [owner, slot, description, photo]);

  it("keeps one entry per slot per day, and updates it", async () => {
    const owner = await newUser();
    await as(owner, async () => {
      const [first] = await save(owner, "Oats");
      const [again] = await save(owner, "Eggs");
      expect(again.id).toBe(first.id);
      await save(owner, "Rice", null, "evening");
      const meals = await rows("select slot, description from public.meals where user_id = $1 order by slot", [owner]);
      expect(meals).toEqual([{ slot: "morning", description: "Eggs" }, { slot: "evening", description: "Rice" }]);
    });
  });

  it("frees the slot when the meal is deleted", async () => {
    const owner = await newUser();
    await as(owner, async () => {
      const [first] = await save(owner, "Oats");
      await rows("select public.soft_delete_entry('meals', $1)", [first.id]);
      const [next] = await save(owner, "Eggs");
      expect(next.id).not.toBe(first.id);
    });
  });

  it("needs a description or a photo", async () => {
    const owner = await newUser();
    await as(owner, async () => {
      await expect(save(owner, "")).rejects.toThrow(/description or a photo/);
      await expect(save(owner, null, `${owner}/a.jpg`)).resolves.toHaveLength(1);
    });
  });

  it("is refused for a stranger and for a friend", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const stranger = await newUser();
    await connect(owner, friend, "friend", { share_meals: true });
    await as(owner, () => save(owner, "Oats"));
    for (const other of [friend, stranger]) {
      await as(other, () => expect(save(owner, "Stolen")).rejects.toThrow(/row-level security/));
    }
    expect(await rows("select description from public.meals where user_id = $1", [owner])).toEqual([{ description: "Oats" }]);
  });
});

describe("storage", () => {
  const object = async (bucket: string, owner: string) =>
    (await rows("insert into storage.objects (bucket_id, name) values ($1, $2) returning id", [bucket, `${owner}/file-${++seq}`]))[0].id as string;
  const seen = (id: string) => rows("select id from storage.objects where id = $1", [id]).then(r => r.length);

  it("creates private buckets only", async () => {
    const buckets = await rows("select id, public from storage.buckets");
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets.every(b => b.public === false)).toBe(true);
  });

  it("follows the sharing ticks for photos and videos", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const stranger = await newUser();
    const id = await connect(owner, friend, "friend");
    const photo = await object("meal-photos", owner);
    const video = await object("workout-media", owner);

    await as(owner, async () => { expect(await seen(photo)).toBe(1); expect(await seen(video)).toBe(1); });
    await as(stranger, async () => { expect(await seen(photo)).toBe(0); expect(await seen(video)).toBe(0); });
    await as(friend, async () => { expect(await seen(photo)).toBe(0); expect(await seen(video)).toBe(1); });

    await rows("update public.connections set share_meal_photos = true where id = $1", [id]);
    await as(friend, async () => expect(await seen(photo)).toBe(1));

    await rows("update public.connections set status = 'revoked' where id = $1", [id]);
    await as(friend, async () => { expect(await seen(photo)).toBe(0); expect(await seen(video)).toBe(0); });
  });

  it("only lets you upload into your own folder", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    await connect(owner, coach, "coach", { share_meal_photos: true });
    await as(coach, async () => {
      await expect(rows("insert into storage.objects (bucket_id, name) values ('meal-photos', $1)", [`${owner}/x.jpg`])).rejects.toThrow(/row-level security/);
      await rows("insert into storage.objects (bucket_id, name) values ('meal-photos', $1)", [`${coach}/x.jpg`]);
    });
  });

  it("isn't tripped up by an odd path", async () => {
    const user = await newUser();
    await rows("insert into storage.objects (bucket_id, name) values ('meal-photos', 'not-a-uuid')");
    await as(user, async () => expect(await rows("select id from storage.objects where name = 'not-a-uuid'")).toEqual([]));
  });
});
