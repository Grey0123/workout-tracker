/**
 * Turns v1's Sheet payload ({ workouts, meals }) into v2 rows. Pure, with no
 * network, so it can be tested and reviewed in a dry run before anything is written.
 *
 * Ids are derived from the v1 data, so running the import twice updates the same
 * rows instead of duplicating them.
 *
 * This repo is public: keep people's actual data out of this file. Only general
 * rules and common exercise names belong here.
 */
import { createHash } from "node:crypto";

const SLOTS = ["morning", "afternoon", "evening"];
const FALLBACK_CATEGORY = "Full body & conditioning";

/**
 * Names that would otherwise split one lift's history in two: misspellings, and
 * machines that are one exercise in the library. The machine is kept in the variant.
 */
const ALIASES = {
  "chess press": { name: "Chest Press" },
  "lap pulldown": { name: "Lat Pulldown" },
  "peck deck fly": { name: "Pec Deck Fly" },
  "reverse peck deck fly": { name: "Reverse Pec Deck Fly" },
  "seated row machine": { name: "Seated Row", variant: "Machine" },
  "low row": { name: "Seated Row", variant: "Low row machine" },
};

/** v1 had no assisted exercises, so they were logged with "assisted" in the variant or notes. */
const ASSISTED = {
  "pull up": "Assisted Pull Up",
  "pull-up": "Assisted Pull Up",
  "dip": "Assisted Dip",
  "chest dip": "Assisted Dip",
  "tricep dip": "Assisted Dip",
};
const ASSISTED_NAMES = new Set(Object.values(ASSISTED).map((n) => n.toLowerCase()));
const ASSIST_WORD = /\bassist(?:ed|ance)?\b/i;

/** Where common v1 names sort. Anything else is flagged in the report for review. */
const CATEGORIES = {
  "assisted dip": "Triceps",
  "assisted pull up": "Back",
  "bench press": "Chest",
  "bicep curl": "Biceps",
  "chest press": "Chest",
  "lat pulldown": "Back",
  "lateral raise": "Shoulders",
  "lunge": "Quads",
  "pec deck fly": "Chest",
  "plank": "Core & abs",
  "pull up": "Back",
  "reverse pec deck fly": "Shoulders",
  "seated row": "Back",
  "shoulder press": "Shoulders",
  "squat": "Quads",
  "treadmill": "Cardio",
  "tricep pushdown": "Triceps",
};

/** A weight typed on a body-weight hold, like a plank, is the person's body weight. */
const BODY_WEIGHT = { min: 30, max: 300 };

const UNITS = { detik: 1, dtk: 1, sec: 1, secs: 1, second: 1, seconds: 1, menit: 60, mnt: 60, min: 60, mins: 60, minute: 60, minutes: 60 };
const DURATION = new RegExp(`(?:^|[^\\p{L}\\d])(?:(\\d+)\\s*)?(${Object.keys(UNITS).join("|")})(?![\\p{L}\\d])`, "iu");

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };

/** A stable UUID (version 5 layout) for one v1 record of one owner. */
export function stableId(owner, kind, key) {
  const hex = createHash("sha1").update(`workouttracker-v1:${owner}:${kind}:${key}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** yyyy-mm-dd, or "" if unreadable. Mirrors toKey() in v1's app.js. */
export function toDate(v) {
  const s = clean(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}

function toTimestamp(v) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Before v1 had a timed mode, holds and cardio were typed as a meaningless weight
 * with the real time in the notes ("30 detik"), and a later timed set could read
 * 20 seconds with the note "Menit". Only rows with no reps at all qualify, and
 * every change is reported, because this is a best reading of the notes.
 *
 * droppedWeight is the weight that was set aside, which on a plank was body weight.
 */
export function readSets(row) {
  const list = (Array.isArray(row.setList) ? row.setList : [])
    .map((s) => ({ w: toNum(s?.w), r: toInt(s?.r), t: toInt(s?.t) }))
    .filter((s) => s.w || s.r || s.t);
  const unchanged = { sets: list, corrected: false, droppedWeight: 0 };
  if (!list.length || list.some((s) => s.r)) return unchanged;

  const match = clean(row.notes).match(DURATION);
  if (!match) return unchanged;

  const seconds = UNITS[match[2].toLowerCase()];
  if (match[1] && list.every((s) => !s.t)) {
    return {
      sets: list.map(() => ({ w: 0, r: 0, t: toInt(match[1]) * seconds })),
      corrected: true,
      droppedWeight: Math.max(...list.map((s) => s.w)),
    };
  }
  if (!match[1] && seconds > 1 && list.every((s) => s.t)) {
    return { sets: list.map((s) => ({ ...s, t: s.t * seconds })), corrected: true, droppedWeight: 0 };
  }
  return unchanged;
}

/** Drops the word "assisted" from a variant once the exercise itself says so. */
const withoutAssist = (variant) => variant.replace(ASSIST_WORD, "").replace(/^[\s·,;-]+|[\s·,;-]+$/g, "");

const describeSets = (list) => list.map((s) => `${s.w}x${s.r}${s.t ? `@${s.t}s` : ""}`).join(" ");

/**
 * @param data     the v1 payload
 * @param owner    the v2 profile id that receives the data
 * @param existing exercises the owner can already use: [{ id, name, is_custom, equipment? }]
 */
export function transform(data, owner, existing = []) {
  const report = { skipped: [], corrected: [], renamed: [], uncategorised: [], duplicateMeals: [], bodyweight: [] };

  const known = new Map();
  for (const e of [...existing].sort((a, b) => Number(b.is_custom) - Number(a.is_custom))) {
    known.set(clean(e.name).toLowerCase(), e);   // built-ins last, so they win
  }
  const bodyweight = new Map();

  // Group each lift across spellings. Most-used spelling becomes the display name.
  const rows = [];
  const groups = new Map();
  for (const row of data.workouts ?? []) {
    const date = toDate(row.date);
    const typed = clean(row.exercise);
    if (!date || !typed) {
      report.skipped.push(`workout ${row.id ?? "?"}: unreadable ${date ? "exercise" : "date"}`);
      continue;
    }
    const alias = ALIASES[typed.toLowerCase()];
    let name = alias?.name ?? typed;
    let variant = [alias?.variant, clean(row.variant)].filter(Boolean).join(" · ");
    const { sets, corrected, droppedWeight } = readSets(row);

    const assisted = ASSISTED[name.toLowerCase()];
    if (assisted && sets.some((s) => s.w) && ASSIST_WORD.test(`${variant} ${clean(row.notes)}`)) {
      name = assisted;
      variant = withoutAssist(variant);
    }
    if (name !== typed || variant !== clean(row.variant)) {
      report.renamed.push(`${date}: "${typed}"${row.variant ? ` (${clean(row.variant)})` : ""} → "${name}"${variant ? ` (${variant})` : ""}`);
    }

    const key = name.toLowerCase();
    if (corrected) {
      report.corrected.push(`${date} ${name}: ${describeSets(readRaw(row))} (note "${clean(row.notes)}") → ${describeSets(sets)}`);
    }
    if (droppedWeight >= BODY_WEIGHT.min && droppedWeight <= BODY_WEIGHT.max && known.get(key)?.equipment === "None") {
      bodyweight.set(date, droppedWeight);
      report.bodyweight.push(`${date}: ${droppedWeight} kg, typed as the weight on ${name}`);
    }
    if (!sets.length) report.skipped.push(`workout ${row.id ?? "?"} on ${date}: ${name} has no usable sets, kept without any`);

    const group = groups.get(key) ?? { spellings: new Map(), sets: [] };
    group.spellings.set(name, (group.spellings.get(name) ?? 0) + 1);
    group.sets.push(...sets);
    groups.set(key, group);
    rows.push({ row, date, key, sets, variant });
  }

  const exercises = [];
  const exerciseIds = new Map();
  for (const [key, group] of groups) {
    const found = known.get(key);
    if (found) {
      exerciseIds.set(key, found.id);
      continue;
    }
    const name = [...group.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const inputs = [
      group.sets.some((s) => s.w) && "weight_kg",
      group.sets.some((s) => s.r) && "reps",
      group.sets.some((s) => s.t) && "duration_s",
    ].filter(Boolean);
    const category = CATEGORIES[key];
    if (!category) report.uncategorised.push(name);
    const id = stableId(owner, "exercise", key);
    exerciseIds.set(key, id);
    exercises.push({
      id,
      name: name.slice(0, 60),
      category: category ?? FALLBACK_CATEGORY,
      kind: "custom",
      inputs: inputs.length ? inputs : ["reps"],
      assisted: ASSISTED_NAMES.has(key) && inputs.includes("weight_kg"),
      is_custom: true,
      created_by: owner,
    });
  }

  const sessions = new Map();
  const sessionExercises = [];
  const sets = [];
  const positions = new Map();
  for (const { row, date, key, sets: list, variant } of rows) {
    const sessionId = stableId(owner, "session", date);
    const stamp = toTimestamp(row.timestamp);
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { id: sessionId, user_id: owner, date, created_by: owner, ...(stamp && { created_at: stamp }) });
    }
    const position = positions.get(date) ?? 0;
    positions.set(date, position + 1);

    const entryId = stableId(owner, "entry", row.id ?? `${date}:${position}`);
    sessionExercises.push({
      id: entryId,
      session_id: sessionId,
      exercise_id: exerciseIds.get(key),
      position,
      variant: variant.slice(0, 100) || null,
      notes: clean(row.notes).slice(0, 500) || null,
      created_by: owner,
      ...(stamp && { created_at: stamp }),
    });
    list.forEach((s, i) => {
      sets.push({
        id: stableId(owner, "set", `${entryId}:${i + 1}`),
        session_exercise_id: entryId,
        set_no: i + 1,
        weight_kg: s.w || null,
        reps: s.r || null,
        duration_s: s.t || null,
        created_by: owner,
      });
    });
  }

  // One entry per slot per day. v1 shows the last row when there are several, so keep that.
  const meals = new Map();
  for (const m of data.meals ?? []) {
    const date = toDate(m.date);
    if (!date) {
      report.skipped.push(`meal ${m.id ?? "?"}: unreadable date`);
      continue;
    }
    const raw = clean(m.slot).toLowerCase();
    const slot = SLOTS.includes(raw) ? raw : "morning";
    const key = `${date}:${slot}`;
    if (meals.has(key)) report.duplicateMeals.push(`${date} ${slot}: kept the later entry`);
    const stamp = toTimestamp(m.timestamp);
    meals.set(key, {
      id: stableId(owner, "meal", key),
      user_id: owner,
      date,
      slot,
      description: clean(m.food).slice(0, 300) || null,
      notes: clean(m.notes).slice(0, 500) || null,
      created_by: owner,
      ...(stamp && { created_at: stamp }),
      photoUrl: clean(m.photoUrl),
    });
  }

  return {
    exercises,
    reusedExercises: groups.size - exercises.length,
    sessions: [...sessions.values()],
    sessionExercises,
    sets,
    meals: [...meals.values()],
    bodyweight: [...bodyweight].map(([date, kg]) => ({ id: stableId(owner, "bodyweight", date), user_id: owner, date, kg })),
    report,
  };
}

function readRaw(row) {
  return (row.setList ?? []).map((s) => ({ w: toNum(s?.w), r: toInt(s?.r), t: toInt(s?.t) }));
}
