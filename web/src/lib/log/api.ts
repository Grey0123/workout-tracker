import { createClient } from "@/lib/supabase/client";
import { CONNECTION_COLUMNS } from "@/lib/people/api";
import { loadNotes, type Note } from "@/lib/coach/api";
import { loadEvaluations, loadVideos, loadWeights, type Evaluation, type Video } from "@/lib/progress/api";
import type { Weight } from "@/lib/progress/calc";
import { loadPlans, loadRoutines } from "@/lib/routines/api";
import type { Plan, Routine } from "@/lib/routines/plan";
import type { CoachAccess, Connection, Person } from "@/lib/people/types";
import { newId } from "./sets";
import type { Entry, Exercise, Meal, MealSlot, Profile, SetValues } from "./types";

const PAGE = 1000;

/** PostgREST returns at most 1000 rows at a time, and a log outgrows that within a year. */
async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

const SET_COLUMNS = "set_no, weight_kg, reps, duration_s, distance_km, rounds, rpe, calories, tempo, side";
const PROFILE_COLUMNS = "id, username, display_name, account_type";
const EXERCISE_COLUMNS = "id, name, category, secondary_muscles, equipment, kind, inputs, per_side, assisted, is_custom, created_by";

type EntryRow = Omit<Entry, "date" | "sets"> & {
  sessions: { date: string };
  sets: (SetValues & { set_no: number })[];
};

/** Someone else's log that isn't shared with the person asking, or no longer is. */
export class NotShared extends Error {}

export type PeopleCounts = { sharingWith: number; requests: number };

export type LogData = {
  /** Whose log this is. */
  profile: Profile;
  /** Who is looking. The same person unless the log was shared with them. */
  me: Profile;
  /** How it was shared, or null for your own log. */
  connection: Connection | null;
  exercises: Exercise[];
  entries: Entry[];
  meals: Meal[];
  people: PeopleCounts;
  /** Coach notes about this person: the coach's own when a coach is looking, the sent ones for the owner. */
  notes: Note[];
  /** Everyone named in this log: who added or edited entries, who wrote notes. */
  actors: Person[];
  /** The owner's coach, when it's your own log. */
  coach: { person: Person; access: CoachAccess } | null;
  /** Body weight, when it's your own log or shared with you. */
  weights: Weight[];
  /** Coach evaluations: all of the owner's, or the ones a coach wrote. */
  evaluations: Evaluation[];
  /** Form videos, wherever workouts are shared. */
  videos: Video[];
  /** Routines put on this person's days, wherever workouts are shared. */
  plans: Plan[];
  /** The routines of whoever is looking: your own, or a coach's to plan with. */
  routines: Routine[];
};

/** Your own log, or with a username, the log someone shares with you. */
export async function loadLog(username?: string): Promise<LogData> {
  const db = createClient();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();
  if (authError || !user) throw new Error(authError?.message ?? "Not signed in.");

  const { data: me, error: meError } = await db.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).single();
  if (meError) throw new Error(meError.message);

  let profile = me as Profile;
  let connection: Connection | null = null;
  if (username && username.toLowerCase() !== profile.username) {
    // Both come back empty unless a connection lets this person see them.
    const { data: owner } = await db.from("profiles").select(PROFILE_COLUMNS).eq("username", username.toLowerCase()).maybeSingle();
    if (!owner) throw new NotShared(username);
    const { data: shared } = await db
      .from("connections")
      .select(CONNECTION_COLUMNS)
      .eq("owner_id", owner.id)
      .eq("viewer_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!shared) throw new NotShared((owner as Profile).display_name);
    profile = owner as Profile;
    connection = shared as unknown as Connection;
  }
  const owner = profile.id;
  const none = async () => [];

  const coachView = connection?.kind === "coach";
  const [exercises, entryRows, mealRows, people, notes, coach, weights, evaluations, videos, plans, routines] = await Promise.all([
    allPages<Exercise>((from, to) => db.from("exercises").select(EXERCISE_COLUMNS).order("name").range(from, to)),
    connection && !connection.share_workouts
      ? none()
      : allPages<EntryRow>((from, to) =>
          db
            .from("session_exercises")
            .select(
              `id, session_id, exercise_id, position, variant, notes, tempo, created_by, updated_by, updated_at, sessions!inner(date), sets(${SET_COLUMNS})`,
            )
            .eq("sessions.user_id", owner)
            .is("sessions.deleted_at", null)
            .order("id")
            .range(from, to) as unknown as PromiseLike<{ data: EntryRow[] | null; error: { message: string } | null }>,
        ),
    connection && !connection.share_meals
      ? none()
      : allPages<Meal>((from, to) =>
          db
            .from("meals")
            .select("id, date, slot, description, notes, photo_path, created_by, updated_by, updated_at")
            .eq("user_id", owner)
            .is("deleted_at", null)
            .order("id")
            .range(from, to),
        ),
    connection ? Promise.resolve({ sharingWith: 0, requests: 0 }) : peopleCounts(user.id),
    connection && !coachView ? none() : loadNotes(owner),
    connection ? Promise.resolve(null) : myCoach(user.id),
    connection && !connection.share_bodyweight ? none() : loadWeights(owner),
    connection && !coachView ? none() : loadEvaluations(owner),
    connection && !connection.share_workouts ? none() : loadVideos(owner),
    connection && !connection.share_workouts ? none() : loadPlans(owner),
    connection && !coachView ? none() : loadRoutines(),
  ]);

  const entries: Entry[] = entryRows
    .map(({ sessions, sets, ...entry }) => ({
      ...entry,
      date: sessions.date,
      sets: [...sets]
        .sort((a, b) => a.set_no - b.set_no)
        .map((s) => ({
          weight_kg: toNumber(s.weight_kg),
          reps: s.reps,
          duration_s: s.duration_s,
          distance_km: toNumber(s.distance_km),
          rounds: s.rounds,
          rpe: toNumber(s.rpe),
          calories: s.calories,
          tempo: s.tempo,
          side: s.side,
        })),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position);

  const named = new Set<string>();
  for (const row of [...entries, ...mealRows]) for (const id of [row.created_by, row.updated_by]) if (id) named.add(id);
  for (const n of notes) named.add(n.coach_id);
  for (const e of evaluations) named.add(e.coach_id);
  for (const p of plans) if (p.assigned_by) named.add(p.assigned_by);
  named.delete(owner);
  named.delete(user.id);
  const actors = named.size
    ? (((await db.from("profiles").select(PROFILE_COLUMNS).in("id", [...named])).data ?? []) as Person[])
    : [];

  return {
    profile, me: me as Profile, connection, exercises, entries, meals: mealRows, people, notes, actors, coach, weights, evaluations, videos, plans, routines,
  };
}

async function myCoach(me: string): Promise<LogData["coach"]> {
  const db = createClient();
  const { data } = await db
    .from("connections")
    .select("viewer_id, coach_access")
    .eq("owner_id", me)
    .eq("kind", "coach")
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;
  const { data: person } = await db.from("profiles").select(PROFILE_COLUMNS).eq("id", data.viewer_id).maybeSingle();
  return person ? { person: person as Person, access: data.coach_access as CoachAccess } : null;
}

/** For the line on Home that says who can see your log. */
async function peopleCounts(me: string): Promise<PeopleCounts> {
  const { data, error } = await createClient()
    .from("connections")
    .select("owner_id, status, requested_by")
    .in("status", ["pending", "active"])
    .or(`owner_id.eq.${me},viewer_id.eq.${me}`);
  if (error) throw new Error(error.message);
  return {
    sharingWith: (data ?? []).filter((c) => c.status === "active" && c.owner_id === me).length,
    requests: (data ?? []).filter((c) => c.status === "pending" && c.requested_by !== me).length,
  };
}

const toNumber = (v: number | string | null) => (v === null ? null : Number(v));

async function check(call: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await call;
  if (error) throw new Error(error.message);
}

export const saveEntry = (userId: string, entry: Entry) =>
  check(
    createClient().rpc("save_session_exercise", {
      p_id: entry.id,
      p_user_id: userId,
      p_date: entry.date,
      p_exercise_id: entry.exercise_id,
      p_variant: entry.variant,
      p_notes: entry.notes,
      p_tempo: entry.tempo,
      p_sets: entry.sets,
    }),
  );

export const deleteEntry = (id: string) => check(createClient().from("session_exercises").delete().eq("id", id));

export async function saveMeal(
  userId: string,
  meal: { date: string; slot: MealSlot; description: string | null; notes: string | null; photo_path: string | null },
): Promise<string> {
  const { data, error } = await createClient().rpc("save_meal", {
    p_user_id: userId,
    p_date: meal.date,
    p_slot: meal.slot,
    p_description: meal.description,
    p_notes: meal.notes,
    p_photo_path: meal.photo_path,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export const deleteMeal = (id: string) => check(createClient().rpc("soft_delete_entry", { p_table: "meals", p_id: id }));

export type ExerciseInput = Pick<
  Exercise,
  "name" | "category" | "secondary_muscles" | "equipment" | "kind" | "inputs" | "per_side" | "assisted"
>;

export async function createExercise(userId: string, input: ExerciseInput): Promise<Exercise> {
  const { data, error } = await createClient()
    .from("exercises")
    .insert({ ...input, is_custom: true, created_by: userId })
    .select(EXERCISE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as Exercise;
}

export async function updateExercise(id: string, input: ExerciseInput): Promise<Exercise> {
  const { data, error } = await createClient().from("exercises").update(input).eq("id", id).select(EXERCISE_COLUMNS).single();
  if (error) throw new Error(error.message);
  return data as Exercise;
}

/* ------------------------------------------------------------------- photos */

const BUCKET = "meal-photos";
const MAX_SIDE = 1200;

/** Phones produce 3–8 MB photos. Resized to at most 1200 px as a JPEG, as v1 does. */
export function resizePhoto(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't read that image."))), "image/jpeg", 0.8);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file couldn't be read as an image."));
    };
    img.src = url;
  });
}

/** A fresh name for every upload, so a replaced photo can't be served from a cache. */
export async function uploadPhoto(userId: string, photo: Blob): Promise<string> {
  const path = `${userId}/${newId()}.jpg`;
  const { error } = await createClient().storage.from(BUCKET).upload(path, photo, { contentType: "image/jpeg" });
  if (error) throw new Error(error.message);
  return path;
}

export async function removePhoto(path: string) {
  await createClient().storage.from(BUCKET).remove([path]);
}

const LINK_LIFETIME = 3600;
const links = new Map<string, { url: string; expires: number }>();

/** Photos are private, so they're shown through short-lived links. */
export async function photoLink(path: string): Promise<string> {
  const known = links.get(path);
  if (known && known.expires > Date.now()) return known.url;
  const { data, error } = await createClient().storage.from(BUCKET).createSignedUrl(path, LINK_LIFETIME);
  if (error || !data) throw new Error(error?.message ?? "Couldn't load that photo.");
  links.set(path, { url: data.signedUrl, expires: Date.now() + (LINK_LIFETIME - 60) * 1000 });
  return data.signedUrl;
}
