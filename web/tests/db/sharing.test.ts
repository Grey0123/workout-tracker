/**
 * How connections are made, changed and ended (PRD 4, 4.1 and 4.2). Every change
 * goes through the database functions, so these are the rules that matter.
 */
import { describe, expect, it } from "vitest";
import { openDb } from "./harness";

const { asRole, as, rows, changed, newUser, connect } = await openDb();

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows(sql, params))[0] as T;

const request = (me: string, other: string, kind: "friend" | "coach", iShare: boolean, opts: { notice?: boolean; replace?: boolean; shares?: object } = {}) =>
  as(me, () =>
    one<{ id: string }>("select public.request_connection($1, $2, $3, $4, $5, $6::jsonb) as id", [
      other, kind, iShare, opts.notice ?? false, opts.replace ?? false, opts.shares ? JSON.stringify(opts.shares) : null,
    ]).then((r) => r.id),
  );

const respond = (me: string, id: string, accept: boolean, opts: { notice?: boolean; replace?: boolean; shares?: object } = {}) =>
  as(me, () =>
    rows("select public.respond_connection($1, $2, $3, $4, $5::jsonb)", [
      id, accept, opts.notice ?? false, opts.replace ?? false, opts.shares ? JSON.stringify(opts.shares) : null,
    ]),
  );

const end = (me: string, id: string) => as(me, () => rows("select public.end_connection($1)", [id]));
const status = async (id: string) => (await one<{ status: string }>("select status from public.connections where id = $1", [id])).status;
const notified = (user: string, type: string) =>
  rows("select actor_id, payload from public.notifications where user_id = $1 and type = $2", [user, type]);

async function logWorkout(owner: string) {
  const [session] = await rows("insert into public.sessions (user_id, date, created_by) values ($1, '2026-11-01', $1) returning id", [owner]);
  return session.id as string;
}
async function logMeal(owner: string) {
  const [meal] = await rows("insert into public.meals (user_id, date, slot, description) values ($1, '2026-11-01', 'morning', 'Oats') returning id", [owner]);
  return meal.id as string;
}
const sees = (viewer: string, table: "sessions" | "meals", id: string) =>
  as(viewer, async () => (await rows(`select id from public.${table} where id = $1`, [id])).length === 1);

describe("finding people", () => {
  it("finds an exact username, ignoring case and a leading @, and nothing partial", async () => {
    const me = await newUser();
    const other = await newUser("coach");
    const [{ username }] = await rows("select username from public.profiles where id = $1", [other]);
    await as(me, async () => {
      expect(await rows("select id, account_type from public.find_person($1)", [`@${String(username).toUpperCase()}`])).toEqual([
        { id: other, account_type: "coach" },
      ]);
      expect(await rows("select id from public.find_person($1)", [String(username).slice(0, 3)])).toEqual([]);
    });
  });
});

describe("asking to share", () => {
  it("offers my log to a friend, who sees it once they accept, workouts only by default", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const session = await logWorkout(owner);
    const meal = await logMeal(owner);

    const id = await request(owner, friend, "friend", true);
    expect(await sees(friend, "sessions", session)).toBe(false);
    expect(await notified(friend, "connection_request")).toEqual([{ actor_id: owner, payload: { connection_id: id, kind: "friend" } }]);

    await respond(friend, id, true);
    expect(await status(id)).toBe("active");
    expect(await sees(friend, "sessions", session)).toBe(true);
    expect(await sees(friend, "meals", meal)).toBe(false);
    expect(await notified(owner, "connection_accepted")).toHaveLength(1);
  });

  it("asks to see someone's log, and the owner picks what to share when accepting", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const meal = await logMeal(owner);

    const id = await request(friend, owner, "friend", false);
    await respond(owner, id, true, { shares: { share_meals: true } });
    expect(await sees(friend, "meals", meal)).toBe(true);
  });

  it("only lets the person who was asked answer", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const stranger = await newUser();
    const id = await request(owner, friend, "friend", true);

    await expect(respond(owner, id, true)).rejects.toThrow(/not allowed/);
    await expect(respond(stranger, id, true)).rejects.toThrow(/not allowed/);
    expect(await status(id)).toBe("pending");
  });

  it("can't be turned into more by the person asking to see", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const meal = await logMeal(owner);
    const id = await request(friend, owner, "friend", false, { shares: { share_meals: true } });
    await respond(owner, id, true);
    expect(await sees(friend, "meals", meal)).toBe(false);
  });

  it("declines quietly, and can be asked again", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const id = await request(owner, friend, "friend", true);
    await respond(friend, id, false);
    expect(await status(id)).toBe("revoked");
    expect(await notified(owner, "connection_accepted")).toEqual([]);
    await expect(request(owner, friend, "friend", true)).resolves.toBeTruthy();
  });

  it("won't connect you to yourself or ask twice", async () => {
    const me = await newUser();
    const friend = await newUser();
    await expect(request(me, me, "friend", true)).rejects.toThrow(/self/);
    await request(me, friend, "friend", true);
    await expect(request(me, friend, "friend", true)).rejects.toThrow(/already_connected/);
  });

  it("can't be done by signed-out visitors", async () => {
    const someone = await newUser();
    for (const sql of [
      "select public.find_person('x')",
      `select public.request_connection('${someone}', 'friend', true)`,
      `select public.create_invite('friend', true)`,
      `select public.invite_details('ABC')`,
    ]) {
      await expect(asRole("anon", "", () => rows(sql))).rejects.toThrow(/permission denied/);
    }
  });

  it("keeps the helpers out of reach", async () => {
    const me = await newUser();
    const other = await newUser();
    const id = await request(me, other, "friend", true);
    await as(me, async () => {
      await expect(rows("select public.activate_connection($1, true)", [id])).rejects.toThrow(/permission denied/);
      await expect(rows("select public.apply_shares($1, '{}'::jsonb)", [id])).rejects.toThrow(/permission denied/);
      await expect(rows("select public.notify_person($1, 'x', '{}'::jsonb)", [other])).rejects.toThrow(/permission denied/);
    });
  });
});

describe("coaches", () => {
  it("must be coach accounts", async () => {
    const owner = await newUser();
    const notCoach = await newUser();
    await expect(request(owner, notCoach, "coach", true, { notice: true })).rejects.toThrow(/not_a_coach/);
    await expect(request(notCoach, owner, "coach", false)).rejects.toThrow(/not_a_coach/);
  });

  it("need the owner to accept the self-declared notice", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    await expect(request(owner, coach, "coach", true)).rejects.toThrow(/coach_notice/);

    const id = await request(coach, owner, "coach", false);
    await expect(respond(owner, id, true)).rejects.toThrow(/coach_notice/);
    await respond(owner, id, true, { notice: true });
    const c = await one("select status, coach_access, coach_access_set_at, coach_notice_accepted_at from public.connections where id = $1", [id]);
    expect(c).toMatchObject({ status: "active", coach_access: "add_edit", coach_access_set_at: null });
    expect(c.coach_notice_accepted_at).not.toBeNull();
  });

  it("see meals by default, since following eating is the point", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    const meal = await logMeal(owner);
    const id = await request(owner, coach, "coach", true, { notice: true });
    await respond(coach, id, true);
    expect(await sees(coach, "meals", meal)).toBe(true);
  });

  it("are one at a time: a second needs the owner's say-so, and the first is told", async () => {
    const owner = await newUser();
    const first = await newUser("coach");
    const second = await newUser("coach");
    const session = await logWorkout(owner);
    const a = await request(owner, first, "coach", true, { notice: true });
    await respond(first, a, true);

    const b = await request(second, owner, "coach", false);
    await expect(respond(owner, b, true, { notice: true })).rejects.toThrow(/has_coach/);
    expect(await status(b)).toBe("pending");

    await respond(owner, b, true, { notice: true, replace: true });
    expect([await status(a), await status(b)]).toEqual(["revoked", "active"]);
    expect(await sees(first, "sessions", session)).toBe(false);
    expect(await sees(second, "sessions", session)).toBe(true);
    expect((await notified(first, "coach_removed"))[0].payload).toMatchObject({ replaced: true });
  });

  it("replace a current coach when the owner agreed while asking", async () => {
    const owner = await newUser();
    const first = await newUser("coach");
    const second = await newUser("coach");
    await respond(first, await request(owner, first, "coach", true, { notice: true }), true);

    const refused = await request(owner, second, "coach", true, { notice: true });
    await expect(respond(second, refused, true)).rejects.toThrow(/has_coach/);
    await end(owner, refused);

    const agreed = await request(owner, second, "coach", true, { notice: true, replace: true });
    await respond(second, agreed, true);
    expect(await status(agreed)).toBe("active");
  });

  it("take over a friend share in the same direction, and can't get one on top", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    const friendship = await request(owner, coach, "friend", true);
    await respond(coach, friendship, true);

    const coaching = await request(owner, coach, "coach", true, { notice: true });
    await respond(coach, coaching, true);
    expect([await status(friendship), await status(coaching)]).toEqual(["revoked", "active"]);
    await expect(request(owner, coach, "friend", true)).rejects.toThrow(/already_coach/);
  });

  it("get the access level the owner picks, and are told", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    const id = await request(owner, coach, "coach", true, { notice: true });
    await respond(coach, id, true);

    await as(coach, () => expect(rows("select public.set_coach_access($1, 'full')", [id])).rejects.toThrow(/not allowed/));
    await as(owner, () => rows("select public.set_coach_access($1, 'full')", [id]));
    const c = await one("select coach_access, coach_access_set_at from public.connections where id = $1", [id]);
    expect(c.coach_access).toBe("full");
    expect(c.coach_access_set_at).not.toBeNull();
    expect((await notified(coach, "coach_access_changed"))[0].payload).toMatchObject({ access: "full" });

    const session = await logWorkout(owner);
    await as(coach, () => rows("select public.soft_delete_entry('sessions', $1)", [session]));
    expect(await one("select deleted_by from public.sessions where id = $1", [session])).toEqual({ deleted_by: coach });
  });

  it("removed by the owner lose access at once and are told", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    const session = await logWorkout(owner);
    const id = await request(owner, coach, "coach", true, { notice: true });
    await respond(coach, id, true);

    await end(owner, id);
    expect(await sees(coach, "sessions", session)).toBe(false);
    expect(await notified(coach, "coach_removed")).toHaveLength(1);
  });
});

describe("ending and changing a connection", () => {
  it("can be done from either side, and access stops at once", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const session = await logWorkout(owner);
    const id = await request(owner, friend, "friend", true);
    await respond(friend, id, true);

    await end(friend, id);
    expect(await sees(friend, "sessions", session)).toBe(false);
    expect(await notified(owner, "connection_ended")).toHaveLength(1);
    await expect(end(friend, id)).rejects.toThrow(/not allowed/);
  });

  it("isn't open to strangers", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const stranger = await newUser();
    const id = await request(owner, friend, "friend", true);
    await respond(friend, id, true);
    await expect(end(stranger, id)).rejects.toThrow(/not allowed/);
    expect(await status(id)).toBe("active");
  });

  it("lets only the owner change what's shared, with meal photos tied to meals", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const id = await request(owner, friend, "friend", true);
    await respond(friend, id, true);

    await as(friend, () => expect(rows("select public.update_sharing($1, '{\"share_meals\": true}'::jsonb)", [id])).rejects.toThrow(/not allowed/));
    await as(owner, () => rows(`select public.update_sharing($1, '{"share_meals": true, "share_meal_photos": true}'::jsonb)`, [id]));
    expect(await one("select share_meals, share_meal_photos from public.connections where id = $1", [id])).toEqual({ share_meals: true, share_meal_photos: true });

    await as(owner, () => rows(`select public.update_sharing($1, '{"share_meals": false}'::jsonb)`, [id]));
    expect(await one("select share_meals, share_meal_photos from public.connections where id = $1", [id])).toEqual({ share_meals: false, share_meal_photos: false });
  });

  it("still can't be written directly", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const id = await connect(owner, friend, "friend");
    await as(owner, async () => {
      await expect(rows("update public.connections set share_meals = true where id = $1", [id])).rejects.toThrow(/permission denied/);
      await expect(rows("insert into public.connections (owner_id, viewer_id, kind) values ($1, $2, 'friend')", [owner, friend])).rejects.toThrow(/permission denied/);
    });
  });
});

describe("invite links", () => {
  const invite = (me: string, kind: "friend" | "coach", inviterShares: boolean, notice = false) =>
    as(me, () => one<{ code: string }>("select public.create_invite($1, $2, $3) as code", [kind, inviterShares, notice]).then((r) => r.code));
  const accept = (me: string, code: string, opts: { notice?: boolean; replace?: boolean; shares?: object } = {}) =>
    as(me, () =>
      one<{ id: string }>("select public.accept_invite($1, $2, $3, $4::jsonb) as id", [
        code, opts.notice ?? false, opts.replace ?? false, opts.shares ? JSON.stringify(opts.shares) : null,
      ]).then((r) => r.id),
    );

  it("share my log with whoever opens it, once", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const late = await newUser();
    const session = await logWorkout(owner);
    const code = await invite(owner, "friend", true);
    expect(code).toMatch(/^[0-9A-F]{10}$/);

    await as(friend, async () => {
      expect(await one("select kind, inviter_shares, usable, mine from public.invite_details($1)", [code.toLowerCase()])).toEqual({
        kind: "friend", inviter_shares: true, usable: true, mine: false,
      });
    });
    const id = await accept(friend, code);
    expect(await status(id)).toBe("active");
    expect(await sees(friend, "sessions", session)).toBe(true);
    expect(await notified(owner, "invite_accepted")).toHaveLength(1);

    await expect(accept(late, code)).rejects.toThrow(/invite_invalid/);
    await as(late, async () => expect((await one("select usable from public.invite_details($1)", [code])).usable).toBe(false));
  });

  it("refuse an expired code, your own, and nonsense", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const code = await invite(owner, "friend", true);
    await expect(accept(owner, code)).rejects.toThrow(/own_invite/);
    await as(friend, async () => expect(await rows("select * from public.invite_details('NOPE')")).toEqual([]));
    await expect(accept(friend, "NOPE")).rejects.toThrow(/invite_invalid/);

    await rows("update public.invites set expires_at = now() - interval '1 minute' where code = $1", [code]);
    await expect(accept(friend, code)).rejects.toThrow(/invite_invalid/);
  });

  it("from a coach make a client, who must accept the notice", async () => {
    const coach = await newUser("coach");
    const client = await newUser();
    const notCoach = await newUser();
    await expect(invite(notCoach, "coach", false)).rejects.toThrow(/not_a_coach/);

    const code = await invite(coach, "coach", false);
    await expect(accept(client, code)).rejects.toThrow(/coach_notice/);
    const id = await accept(client, code, { notice: true, shares: { share_meals: false } });
    expect(await one("select owner_id, viewer_id, kind, status, share_meals from public.connections where id = $1", [id])).toEqual({
      owner_id: client, viewer_id: coach, kind: "coach", status: "active", share_meals: false,
    });
  });

  it("for my coach need the notice up front, and a coach to open them", async () => {
    const owner = await newUser();
    const coach = await newUser("coach");
    const notCoach = await newUser();
    await expect(invite(owner, "coach", true)).rejects.toThrow(/coach_notice/);
    const code = await invite(owner, "coach", true, true);
    await expect(accept(notCoach, code)).rejects.toThrow(/not_a_coach/);
    const id = await accept(coach, code);
    expect(await status(id)).toBe("active");
  });

  it("accept a request that was already waiting instead of making a second", async () => {
    const owner = await newUser();
    const friend = await newUser();
    const pending = await request(friend, owner, "friend", false);
    const code = await invite(owner, "friend", true);
    expect(await accept(friend, code)).toBe(pending);
    expect(await status(pending)).toBe("active");
  });

  it("are limited, and only their maker can delete them", async () => {
    const owner = await newUser();
    const other = await newUser();
    const code = await invite(owner, "friend", true);
    await as(other, async () => expect(await changed("delete from public.invites where code = $1", [code])).toBe(0));
    await as(owner, async () => expect(await changed("delete from public.invites where code = $1", [code])).toBe(1));

    for (let i = 0; i < 20; i++) await invite(owner, "friend", true);
    await expect(invite(owner, "friend", true)).rejects.toThrow(/too_many_invites/);
  });
});
