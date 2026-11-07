/** Writes a transform() plan to Supabase with the secret key. Safe to run again. */

/** Drive share links aren't file links. The download endpoint serves the bytes. */
export function driveDownloadUrl(url) {
  const s = String(url ?? "");
  const id = s.match(/\/d\/([A-Za-z0-9_-]{10,})/)?.[1] ?? s.match(/[?&]id=([A-Za-z0-9_-]{10,})/)?.[1];
  return id ? `https://drive.google.com/uc?export=download&id=${id}` : s;
}

async function upsert(db, table, rows) {
  if (!rows.length) return;
  // Not every row has a timestamp. Without this, a batch sends null for the missing ones.
  const { error } = await db.from(table).upsert(rows, { defaultToNull: false });
  if (error) throw new Error(`${table}: ${error.message}`);
}

/** A meal keeps its text if its photo can't be copied. Failures are returned, not fatal. */
async function copyPhoto(db, owner, meal, fetcher) {
  const res = await fetcher(driveDownloadUrl(meal.photoUrl));
  if (!res.ok) throw new Error(`download returned ${res.status}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0];
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) throw new Error(`not an image (${type || "unknown type"})`);
  const path = `${owner}/${meal.id}.${type.split("/")[1]}`;
  const { error } = await db.storage.from("meal-photos").upload(path, await res.arrayBuffer(), { contentType: type, upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

export async function writePlan(db, owner, plan, { fetcher = fetch } = {}) {
  await upsert(db, "exercises", plan.exercises);
  await upsert(db, "sessions", plan.sessions);
  await upsert(db, "session_exercises", plan.sessionExercises);

  // Replace rather than merge, so a v1 row edited to fewer sets doesn't keep the old
  // extras. Only sets under rows this import owns are touched, never anything from v2.
  const entries = plan.sessionExercises.map((e) => e.id);
  for (let i = 0; i < entries.length; i += 100) {
    const { error } = await db.from("sets").delete().in("session_exercise_id", entries.slice(i, i + 100));
    if (error) throw new Error(`sets: ${error.message}`);
  }
  await upsert(db, "sets", plan.sets);

  const photoFailures = [];
  const meals = [];
  for (const { photoUrl, ...meal } of plan.meals) {
    let photo_path = null;
    if (photoUrl) {
      try {
        photo_path = await copyPhoto(db, owner, { ...meal, photoUrl }, fetcher);
      } catch (err) {
        photoFailures.push(`${meal.date} ${meal.slot}: ${err.message}`);
      }
    }
    meals.push({ ...meal, photo_path });
  }
  await upsert(db, "meals", meals);
  return { photoFailures };
}

const volume = (sets) => sets.reduce((sum, s) => sum + Number(s.weight_kg ?? 0) * Number(s.reps ?? 0), 0);

/** Reads back what landed and compares it with the plan. Returns any mismatches. */
export async function verifyPlan(db, owner, plan) {
  const problems = [];
  const sessionIds = plan.sessions.map((s) => s.id);
  const count = async (label, query, expected) => {
    const { count: actual, error } = await query;
    if (error) problems.push(`${label}: ${error.message}`);
    else if (actual !== expected) problems.push(`${label}: expected ${expected}, found ${actual}`);
  };
  await count("sessions", db.from("sessions").select("id", { count: "exact", head: true }).in("id", sessionIds), plan.sessions.length);
  await count("exercise entries", db.from("session_exercises").select("id", { count: "exact", head: true }).in("session_id", sessionIds), plan.sessionExercises.length);
  await count("meals", db.from("meals").select("id", { count: "exact", head: true }).in("id", plan.meals.map((m) => m.id)), plan.meals.length);

  const { data: stored, error } = await db
    .from("sets")
    .select("weight_kg, reps")
    .in("session_exercise_id", plan.sessionExercises.map((e) => e.id))
    .limit(100000);
  if (error) {
    problems.push(`sets: ${error.message}`);
  } else {
    if (stored.length !== plan.sets.length) problems.push(`sets: expected ${plan.sets.length}, found ${stored.length}`);
    if (Math.abs(volume(stored) - volume(plan.sets)) > 0.01) problems.push(`volume: expected ${volume(plan.sets)} kg, found ${volume(stored)} kg`);
  }
  return problems;
}
