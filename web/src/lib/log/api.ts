import { createClient } from "@/lib/supabase/client";
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
const EXERCISE_COLUMNS = "id, name, category, secondary_muscles, equipment, kind, inputs, per_side, assisted, is_custom, created_by";

type EntryRow = Omit<Entry, "date" | "sets"> & {
  sessions: { date: string };
  sets: (SetValues & { set_no: number })[];
};

export type LogData = { profile: Profile; exercises: Exercise[]; entries: Entry[]; meals: Meal[] };

export async function loadLog(): Promise<LogData> {
  const db = createClient();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();
  if (authError || !user) throw new Error(authError?.message ?? "Not signed in.");

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, username, display_name, account_type")
    .eq("id", user.id)
    .single();
  if (profileError) throw new Error(profileError.message);

  const [exercises, entryRows, mealRows] = await Promise.all([
    allPages<Exercise>((from, to) => db.from("exercises").select(EXERCISE_COLUMNS).order("name").range(from, to)),
    allPages<EntryRow>((from, to) =>
      db
        .from("session_exercises")
        .select(`id, exercise_id, position, variant, notes, tempo, sessions!inner(date), sets(${SET_COLUMNS})`)
        .eq("sessions.user_id", user.id)
        .is("sessions.deleted_at", null)
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: EntryRow[] | null; error: { message: string } | null }>,
    ),
    allPages<Meal>((from, to) =>
      db
        .from("meals")
        .select("id, date, slot, description, notes, photo_path")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("id")
        .range(from, to),
    ),
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

  return { profile: profile as Profile, exercises, entries, meals: mealRows };
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
