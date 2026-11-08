import { newId } from "@/lib/log/sets";
import { createClient } from "@/lib/supabase/client";
import type { Weight } from "./calc";

async function check<T>(call: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await call;
  if (error) throw new Error(error.message);
  return data as T;
}

/* ------------------------------------------------------------- body weight */

export async function loadWeights(userId: string): Promise<Weight[]> {
  const rows = await check<{ date: string; kg: number | string }[]>(
    createClient().from("bodyweight").select("date, kg").eq("user_id", userId).order("date"),
  );
  return rows.map((r) => ({ date: r.date, kg: Number(r.kg) }));
}

/** One weigh-in a day: logging the same day again replaces it. */
export async function saveWeight(userId: string, date: string, kg: number) {
  await check(createClient().from("bodyweight").upsert({ user_id: userId, date, kg }, { onConflict: "user_id,date" }));
}

/* ------------------------------------------------------------- evaluations */

export type Evaluation = {
  id: string;
  coach_id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  feedback: string;
  rating_training: number | null;
  rating_nutrition: number | null;
  rating_consistency: number | null;
  next_goals: string[];
  created_at: string;
};

const EVALUATION_COLUMNS =
  "id, coach_id, user_id, period_start, period_end, feedback, rating_training, rating_nutrition, rating_consistency, next_goals, created_at";

/** The client's, or for a coach, the ones they wrote for this client. */
export const loadEvaluations = (userId: string) =>
  check<Evaluation[]>(
    createClient().from("evaluations").select(EVALUATION_COLUMNS).eq("user_id", userId).order("period_end", { ascending: false }),
  );

export type EvaluationInput = Omit<Evaluation, "id" | "coach_id" | "user_id" | "created_at">;

export async function saveEvaluation(coachId: string, userId: string, id: string | null, input: EvaluationInput): Promise<Evaluation> {
  const db = createClient();
  return check<Evaluation>(
    id
      ? db.from("evaluations").update(input).eq("id", id).select(EVALUATION_COLUMNS).single()
      : db.from("evaluations").insert({ ...input, coach_id: coachId, user_id: userId }).select(EVALUATION_COLUMNS).single(),
  );
}

export async function deleteEvaluation(id: string) {
  await check(createClient().from("evaluations").delete().eq("id", id));
}

/* ------------------------------------------------------------------ videos */

export type Video = {
  id: string;
  session_id: string;
  exercise_id: string | null;
  path: string;
  duration_s: number | null;
  created_at: string;
};

const BUCKET = "workout-media";
export const MAX_VIDEO_SECONDS = 60;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export const loadVideos = (userId: string) =>
  check<Video[]>(
    createClient()
      .from("workout_media")
      .select("id, session_id, exercise_id, path, duration_s, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  );

/**
 * How long a clip is, read by the browser before anything is uploaded. NaN when it
 * can't tell: WebM recorded in a browser often doesn't say, and some browsers can't
 * read every phone format (an iPhone's HEVC on Windows), though the file is fine.
 */
export function videoSeconds(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    const done = (seconds: number) => {
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : NaN);
    video.onerror = () => done(NaN);
    video.src = url;
  });
}

const TYPES: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

/** Checks the clip, uploads it into the owner's folder, then records it against the exercise. */
export async function uploadVideo(userId: string, entryId: string, exerciseId: string, file: File): Promise<Video> {
  const ext = TYPES[file.type];
  if (!ext) throw new Error("Use an MP4, WebM or MOV video.");
  if (file.size > MAX_VIDEO_BYTES) throw new Error("That video is over 50 MB. Trim it and try again.");
  // A clip that doesn't state its length is still held to the size limit.
  const seconds = await videoSeconds(file);
  if (seconds > MAX_VIDEO_SECONDS + 0.5) throw new Error("Videos can be up to a minute long. Trim it and try again.");

  const db = createClient();
  // The session is only known once the exercise is saved, so look it up rather than trust what's on screen.
  const { session_id } = await check<{ session_id: string }>(db.from("session_exercises").select("session_id").eq("id", entryId).single());
  const path = `${userId}/${newId()}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  try {
    return await check<Video>(
      db
        .from("workout_media")
        .insert({ user_id: userId, session_id, exercise_id: exerciseId, path, duration_s: Number.isFinite(seconds) ? Math.max(1, Math.round(seconds)) : null })
        .select("id, session_id, exercise_id, path, duration_s, created_at")
        .single(),
    );
  } catch (err) {
    await db.storage.from(BUCKET).remove([path]);
    throw err;
  }
}

export async function deleteVideo(video: Video) {
  const db = createClient();
  await check(db.from("workout_media").delete().eq("id", video.id));
  await db.storage.from(BUCKET).remove([video.path]);
}

const links = new Map<string, { url: string; expires: number }>();

export async function videoLink(path: string): Promise<string> {
  const known = links.get(path);
  if (known && known.expires > Date.now()) return known.url;
  const { data, error } = await createClient().storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data) throw new Error(error?.message ?? "Couldn't load that video.");
  links.set(path, { url: data.signedUrl, expires: Date.now() + 3540 * 1000 });
  return data.signedUrl;
}

/* --------------------------------------------------------- progress photos */

export type Pose = "front" | "side" | "back" | "other";
export const POSES: { value: Pose; label: string }[] = [
  { value: "front", label: "Front" },
  { value: "side", label: "Side" },
  { value: "back", label: "Back" },
  { value: "other", label: "Other" },
];

export type ProgressPhoto = { id: string; date: string; pose: Pose; path: string; note: string | null; created_at: string };

const PHOTO_BUCKET = "progress-photos";
const PHOTO_COLUMNS = "id, date, pose, path, note, created_at";

/** The owner's, or someone else's when they ticked Progress photos for you. */
export const loadProgressPhotos = (userId: string) =>
  check<ProgressPhoto[]>(createClient().from("progress_photos").select(PHOTO_COLUMNS).eq("user_id", userId).order("date").order("created_at"));

/** Uploads an already resized JPEG into the owner's folder, then records it. */
export async function addProgressPhoto(userId: string, photo: Blob, date: string, pose: Pose, note: string | null): Promise<ProgressPhoto> {
  const db = createClient();
  const path = `${userId}/${newId()}.jpg`;
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, photo, { contentType: "image/jpeg" });
  if (error) throw new Error(error.message);
  try {
    return await check<ProgressPhoto>(
      db.from("progress_photos").insert({ user_id: userId, date, pose, path, note }).select(PHOTO_COLUMNS).single(),
    );
  } catch (err) {
    await db.storage.from(PHOTO_BUCKET).remove([path]);
    throw err;
  }
}

export async function deleteProgressPhoto(photo: ProgressPhoto) {
  const db = createClient();
  await check(db.from("progress_photos").delete().eq("id", photo.id));
  await db.storage.from(PHOTO_BUCKET).remove([photo.path]);
}

const photoLinks = new Map<string, { url: string; expires: number }>();

export async function progressPhotoLink(path: string): Promise<string> {
  const known = photoLinks.get(path);
  if (known && known.expires > Date.now()) return known.url;
  const { data, error } = await createClient().storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
  if (error || !data) throw new Error(error?.message ?? "Couldn't load that photo.");
  photoLinks.set(path, { url: data.signedUrl, expires: Date.now() + 3540 * 1000 });
  return data.signedUrl;
}
