/**
 * The access rules through the real stack: Supabase Auth, the API and Storage,
 * as the website reaches them. access-rules.test.ts covers the rules in depth
 * with stand-ins. This one proves they hold on real Supabase.
 *
 * Needs `npm run db:start` and a .env.local. Skipped otherwise, and never points
 * at anything but a local address, because it writes test accounts.
 */
import { existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { transform } from "../../scripts/import-v1/transform.mjs";
import { verifyPlan, writePlan } from "../../scripts/import-v1/write.mjs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url);

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const client = () => createClient(url, key, options);
const run = `${Date.now().toString(36)}_`;
let seq = 0;

type Person = { id: string; db: SupabaseClient };

async function signUp(type: "user" | "coach" = "user"): Promise<Person> {
  const db = client();
  const name = `${run}${++seq}`;
  const { data, error } = await db.auth.signUp({
    email: `${name}@example.com`,
    password: "correct-horse-battery",
    options: {
      data: { username: name, display_name: name, account_type: type, coach_disclaimer_accepted: type === "coach" },
    },
  });
  expect(error).toBeNull();
  expect(data.session).not.toBeNull();
  return { id: data.user!.id, db };
}

describe.skipIf(!isLocal || !secret)("real Supabase, running locally", () => {
  const admin = createClient(url || "http://127.0.0.1", secret || "unset", options);
  let exerciseId: string;

  const connect = async (owner: Person, viewer: Person, kind: "friend" | "coach", extra = {}) => {
    const { data, error } = await admin
      .from("connections")
      .insert({ owner_id: owner.id, viewer_id: viewer.id, kind, status: "active", ...extra })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  };

  const session = async (owner: Person) => {
    const { data, error } = await owner.db
      .from("sessions")
      .insert({ user_id: owner.id, date: "2026-10-27" })
      .select("id, created_by")
      .single();
    expect(error).toBeNull();
    return data!;
  };

  beforeAll(async () => {
    const { data, error } = await admin
      .from("exercises")
      .insert({ name: `Bench ${run}`, category: "Chest", kind: "weighted", inputs: ["weight_kg", "reps"] })
      .select("id")
      .single();
    expect(error).toBeNull();
    exerciseId = data!.id;
  });

  it("creates a profile at sign-up", async () => {
    const coach = await signUp("coach");
    const { data } = await coach.db.from("profiles").select("account_type, coach_disclaimer_accepted_at").eq("id", coach.id).single();
    expect(data?.account_type).toBe("coach");
    expect(data?.coach_disclaimer_accepted_at).not.toBeNull();
  });

  it("refuses a coach sign-up without the notice, and a taken username", async () => {
    const first = client();
    const name = `${run}${++seq}`;
    const refused = await first.auth.signUp({
      email: `${name}@example.com`,
      password: "correct-horse-battery",
      options: { data: { username: name, display_name: name, account_type: "coach" } },
    });
    expect(refused.error?.message).toMatch(/Database error/);

    const taken = `${run}${++seq}`;
    const meta = { username: taken, display_name: taken };
    expect((await client().auth.signUp({ email: `${taken}@example.com`, password: "correct-horse-battery", options: { data: meta } })).error).toBeNull();
    const again = await client().auth.signUp({ email: `${taken}b@example.com`, password: "correct-horse-battery", options: { data: meta } });
    expect(again.error?.message).toMatch(/Database error/);
  });

  it("gives signed-out visitors nothing, and no way to list buckets' files", async () => {
    const owner = await signUp();
    await session(owner);
    for (const table of ["profiles", "sessions", "sets", "meals", "connections", "coach_notes", "notifications"]) {
      const { data, error } = await client().from(table).select("*");
      expect(error?.code ?? "").toBe("42501");
      expect(data).toBeNull();
    }
    const files = await client().storage.from("meal-photos").list(owner.id);
    expect(files.data ?? []).toEqual([]);
  });

  it("keeps people out of each other's logs and stamps who wrote what", async () => {
    const owner = await signUp();
    const stranger = await signUp();
    const s = await session(owner);
    expect(s.created_by).toBe(owner.id);

    expect((await stranger.db.from("sessions").select("id").eq("id", s.id)).data).toEqual([]);
    expect((await stranger.db.from("profiles").select("id").eq("id", owner.id)).data).toEqual([]);
    expect((await stranger.db.from("sessions").insert({ user_id: owner.id, date: "2026-10-28" })).error?.code).toBe("42501");
  });

  it("doesn't let anyone create or change a connection through the API", async () => {
    const owner = await signUp();
    const coach = await signUp("coach");
    const insert = await coach.db.from("connections").insert({ owner_id: owner.id, viewer_id: coach.id, kind: "coach", status: "active" });
    expect(insert.error?.code).toBe("42501");

    const id = await connect(owner, coach, "coach");
    const raise = await coach.db.from("connections").update({ coach_access: "full" }).eq("id", id);
    expect(raise.error?.code).toBe("42501");
  });

  it("lets a coach edit, not delete, and tells the client what changed", async () => {
    const owner = await signUp();
    const coach = await signUp("coach");
    await connect(owner, coach, "coach");
    const s = await session(owner);
    const { data: entry } = await owner.db.from("session_exercises").insert({ session_id: s.id, exercise_id: exerciseId }).select("id").single();
    const { data: set } = await owner.db.from("sets").insert({ session_exercise_id: entry!.id, set_no: 1, weight_kg: 60, reps: 8 }).select("id").single();

    const edit = await coach.db.from("sets").update({ weight_kg: 65 }).eq("id", set!.id).select("updated_by").single();
    expect(edit.error).toBeNull();
    expect(edit.data?.updated_by).toBe(coach.id);

    const { data: notes } = await owner.db.from("notifications").select("type, actor_id, payload");
    const note = notes?.find(n => n.payload.row_id === set!.id);
    expect(note?.type).toBe("coach_change");
    expect(note?.actor_id).toBe(coach.id);
    expect(note?.payload.before.weight_kg).toBe(60);
    expect(note?.payload.after.weight_kg).toBe(65);

    const removed = await coach.db.from("sessions").delete().eq("id", s.id).select("id");
    expect(removed.data).toEqual([]);
    expect((await coach.db.rpc("soft_delete_entry", { p_table: "sessions", p_id: s.id })).error?.code).toBe("42501");
    expect((await owner.db.from("sessions").select("id").eq("id", s.id)).data).toHaveLength(1);
  });

  it("ends a removed coach's access at once", async () => {
    const owner = await signUp();
    const coach = await signUp("coach");
    const id = await connect(owner, coach, "coach");
    const s = await session(owner);
    expect((await coach.db.from("sessions").select("id").eq("id", s.id)).data).toHaveLength(1);

    await admin.from("connections").update({ status: "revoked" }).eq("id", id);
    expect((await coach.db.from("sessions").select("id").eq("id", s.id)).data).toEqual([]);
  });

  describe("saving at the same moment", () => {
    const save = (me: Person, id: string, weight_kg: number) =>
      me.db.rpc("save_session_exercise", {
        p_id: id,
        p_user_id: me.id,
        p_date: "2026-11-01",
        p_exercise_id: exerciseId,
        p_variant: null,
        p_notes: null,
        p_tempo: null,
        p_sets: [{ weight_kg, reps: 5 }],
      });

    it("logs a retried save once", async () => {
      const owner = await signUp();
      const id = crypto.randomUUID();
      const results = await Promise.all([save(owner, id, 60), save(owner, id, 60), save(owner, id, 60)]);
      expect(results.map((r) => r.error)).toEqual([null, null, null]);
      expect((await owner.db.from("session_exercises").select("id")).data).toHaveLength(1);
      expect((await owner.db.from("sets").select("id")).data).toHaveLength(1);
    });

    it("keeps one session per day", async () => {
      const owner = await signUp();
      const results = await Promise.all([1, 2, 3, 4].map((n) => save(owner, crypto.randomUUID(), n * 10)));
      expect(results.map((r) => r.error)).toEqual([null, null, null, null]);
      expect((await owner.db.from("sessions").select("id")).data).toHaveLength(1);
      expect((await owner.db.from("session_exercises").select("id")).data).toHaveLength(4);
    });
  });

  describe("v1 import", () => {
    const v1 = {
      workouts: [
        { id: "w1", timestamp: "Tue Jul 21 2026 22:58:23 GMT+0700", date: "2026-07-20", exercise: `Row ${run}`, variant: "Mesin", notes: "", setList: [{ w: 40, r: 10 }, { w: 50, r: 8 }] },
        { id: "w2", timestamp: "", date: "2026-07-20", exercise: `Hold ${run}`, variant: "", notes: "30 detik", setList: [{ w: 50, r: 0 }] },
      ],
      meals: [
        { id: "m1", timestamp: "", date: "2026-07-20", slot: "morning", food: "Oats", notes: "", photoUrl: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view" },
        { id: "m2", timestamp: "", date: "2026-07-20", slot: "evening", food: "Rice", notes: "", photoUrl: "https://drive.google.com/file/d/2AbCdEfGhIjKlMnOp/view" },
      ],
    };
    const image = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { "content-type": "image/jpeg" } });

    it("lands correctly, belongs to the owner, and stays private", async () => {
      const owner = await signUp();
      const stranger = await signUp();
      const plan = transform(v1, owner.id);

      const { photoFailures } = await writePlan(admin, owner.id, plan, {
        fetcher: async (url) => (String(url).includes("2AbC") ? new Response("nope", { status: 403 }) : image()),
      });
      expect(photoFailures).toHaveLength(1);
      expect(await verifyPlan(admin, owner.id, plan)).toEqual([]);

      const { data: sessions } = await owner.db.from("sessions").select("id, date, created_by, session_exercises(variant, sets(weight_kg, reps, duration_s))").eq("date", "2026-07-20");
      expect(sessions).toHaveLength(1);
      expect(sessions![0].created_by).toBe(owner.id);
      const allSets = sessions![0].session_exercises.flatMap((e) => e.sets);
      expect(allSets).toHaveLength(3);
      expect(allSets.find((s) => s.duration_s === 30)).toMatchObject({ weight_kg: null, reps: null });

      const { data: meals } = await owner.db.from("meals").select("slot, description, photo_path").order("slot");
      expect(meals?.map((m) => m.description)).toEqual(["Oats", "Rice"]);
      expect(meals?.[1].photo_path).toBeNull();
      expect((await owner.db.storage.from("meal-photos").createSignedUrl(meals![0].photo_path!, 60)).error).toBeNull();
      expect((await stranger.db.storage.from("meal-photos").createSignedUrl(meals![0].photo_path!, 60)).error).not.toBeNull();

      expect((await stranger.db.from("sessions").select("id").eq("id", plan.sessions[0].id)).data).toEqual([]);
      expect((await owner.db.from("notifications").select("id")).data).toEqual([]);
      expect((await owner.db.from("edit_history").select("id")).data).toEqual([]);
    });

    it("can run twice without duplicates, and follows edits to v1", async () => {
      const owner = await signUp();
      const plan = transform(v1, owner.id);
      await writePlan(admin, owner.id, plan, { fetcher: async () => image() });
      await writePlan(admin, owner.id, plan, { fetcher: async () => image() });
      expect(await verifyPlan(admin, owner.id, plan)).toEqual([]);
      expect((await owner.db.from("sessions").select("id")).data).toHaveLength(1);

      const edited = structuredClone(v1);
      edited.workouts[0].setList.pop();
      const { data: mine } = await admin.from("exercises").select("id, name, is_custom").eq("created_by", owner.id);
      const next = transform(edited, owner.id, mine!);
      expect(next.exercises).toEqual([]);
      await writePlan(admin, owner.id, next, { fetcher: async () => image() });
      expect(await verifyPlan(admin, owner.id, next)).toEqual([]);
    });

    it("leaves what the owner added in v2 alone", async () => {
      const owner = await signUp();
      const plan = transform(v1, owner.id);
      await writePlan(admin, owner.id, plan, { fetcher: async () => image() });

      const { data: added } = await owner.db.from("session_exercises").insert({ session_id: plan.sessions[0].id, exercise_id: exerciseId }).select("id").single();
      await owner.db.from("sets").insert({ session_exercise_id: added!.id, set_no: 1, weight_kg: 70, reps: 5 });

      await writePlan(admin, owner.id, plan, { fetcher: async () => image() });
      expect((await owner.db.from("sets").select("id").eq("session_exercise_id", added!.id)).data).toHaveLength(1);
    });
  });

  describe("files", () => {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });

    it("are private, and only reach people the owner has ticked photos on for", async () => {
      const owner = await signUp();
      const friend = await signUp();
      const stranger = await signUp();
      const id = await connect(owner, friend, "friend");
      const path = `${owner.id}/breakfast.jpg`;

      expect((await owner.db.storage.from("meal-photos").upload(path, jpeg)).error).toBeNull();
      expect((await owner.db.storage.from("meal-photos").createSignedUrl(path, 60)).error).toBeNull();

      const { data: bucket } = await admin.storage.getBucket("meal-photos");
      expect(bucket?.public).toBe(false);
      const publicUrl = client().storage.from("meal-photos").getPublicUrl(path).data.publicUrl;
      expect((await fetch(publicUrl)).ok).toBe(false);

      expect((await stranger.db.storage.from("meal-photos").createSignedUrl(path, 60)).error).not.toBeNull();
      expect((await friend.db.storage.from("meal-photos").createSignedUrl(path, 60)).error).not.toBeNull();

      await admin.from("connections").update({ share_meal_photos: true }).eq("id", id);
      const signed = await friend.db.storage.from("meal-photos").createSignedUrl(path, 60);
      expect(signed.error).toBeNull();
      expect((await fetch(signed.data!.signedUrl)).ok).toBe(true);

      await admin.from("connections").update({ status: "revoked" }).eq("id", id);
      expect((await friend.db.storage.from("meal-photos").createSignedUrl(path, 60)).error).not.toBeNull();
    });

    it("can only be uploaded into your own folder, and only as the right type", async () => {
      const owner = await signUp();
      const coach = await signUp("coach");
      await connect(owner, coach, "coach", { share_meal_photos: true });

      expect((await coach.db.storage.from("meal-photos").upload(`${owner.id}/x.jpg`, jpeg)).error).not.toBeNull();
      const script = new Blob(["<script></script>"], { type: "text/html" });
      expect((await owner.db.storage.from("meal-photos").upload(`${owner.id}/x.html`, script)).error).not.toBeNull();
    });
  });
});
