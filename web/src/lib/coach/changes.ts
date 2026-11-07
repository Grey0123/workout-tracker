/**
 * Turns edit-history rows into what a person would say happened: "changed Bench
 * Press set 2: 60 kg × 8 → 65 kg × 8". Used by the history, the notifications and a
 * coach's list of their own changes. Pure, so it's tested on its own.
 */
import { niceDate } from "../log/dates";
import { fmtKg, fmtTime } from "../log/sets";

type Values = Record<string, unknown>;

export type Change = {
  id: string;
  table_name: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  row_id: string;
  changed_by: string | null;
  changed_at: string;
  /** The transaction. Everything one save did shares it. */
  tx: string;
  before: Values | null;
  after: Values | null;
};

export type ChangeContext = {
  exerciseName: (id: string) => string | undefined;
  /** An exercise entry still in the log: which exercise, on which day. */
  entry: (id: string) => { exerciseId: string; date: string } | undefined;
  sessionDate: (id: string) => string | undefined;
  /** "your" when the owner reads it, "their" for anyone else. */
  whose: "your" | "their";
};

/** One thing that happened to one exercise, meal or day. */
export type Described = {
  what: string;
  date: string | null;
  details: string[];
  /** What to open the history of. */
  target: { table: "session_exercises" | "meals"; id: string } | null;
};

/** Newest first, as given, with each save's rows together. */
export function groupByTx(changes: Change[]): Change[][] {
  const groups = new Map<string, Change[]>();
  for (const c of changes) groups.set(c.tx, [...(groups.get(c.tx) ?? []), c]);
  return [...groups.values()];
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

/** "60 kg × 8", "8 reps", "45s", with distance and the rest after it. */
export function fmtSet(s: Values): string {
  const w = num(s.weight_kg);
  const r = num(s.reps);
  const t = num(s.duration_s);
  let main = w && r ? `${fmtKg(w)} kg × ${r}` : w ? `${fmtKg(w)} kg` : r ? `${r} reps` : "";
  if (t) main = main ? `${main}, ${fmtTime(t)}` : fmtTime(t);
  const extra: string[] = [];
  if (num(s.distance_km)) extra.push(`${fmtKg(num(s.distance_km))} km`);
  if (num(s.rounds)) extra.push(`${num(s.rounds)} rounds`);
  if (num(s.rpe)) extra.push(`RPE ${fmtKg(num(s.rpe))}`);
  if (num(s.calories)) extra.push(`${num(s.calories)} kcal`);
  if (s.side) extra.push(s.side === "left" ? "left" : "right");
  return [main, ...extra].filter(Boolean).join(" · ") || "empty";
}

export const fmtDay = (key: string) => niceDate(key, { weekday: "short", day: "numeric", month: "short" });

const quote = (v: unknown) => `“${String(v)}”`;

/** "variant “Paused” → “Wide”", "added notes “...”", "removed the tempo". */
function textChange(label: string, before: unknown, after: unknown): string | null {
  const a = before ?? null;
  const b = after ?? null;
  if (a === b) return null;
  if (a === null) return `added ${label} ${quote(b)}`;
  if (b === null) return `removed ${label} ${quote(a)}`;
  return `${label} ${quote(a)} → ${quote(b)}`;
}

function describeEntry(id: string, entryRow: Change | undefined, setRows: Change[], ctx: ChangeContext): Described {
  const values = entryRow?.after ?? entryRow?.before;
  const known = ctx.entry(id);
  const exerciseId = String(values?.exercise_id ?? known?.exerciseId ?? "");
  const name = ctx.exerciseName(exerciseId) ?? "an exercise";
  const date = known?.date ?? (values?.session_id ? (ctx.sessionDate(String(values.session_id)) ?? null) : null);
  const target = { table: "session_exercises" as const, id };
  const setNo = (c: Change) => num((c.after ?? c.before)?.set_no);
  const bySet = [...setRows].sort((a, b) => setNo(a) - setNo(b));

  if (entryRow?.op === "INSERT") {
    const added = bySet.filter((c) => c.op === "INSERT").map((c) => fmtSet(c.after!));
    return { what: `added ${name}`, date, details: added.length ? [`${added.length === 1 ? "1 set" : `${added.length} sets`}: ${added.join(", ")}`] : [], target };
  }
  if (entryRow?.op === "DELETE") {
    const gone = bySet.filter((c) => c.op === "DELETE").map((c) => fmtSet(c.before!));
    return { what: `deleted ${name}`, date, details: gone.length ? [`${gone.length === 1 ? "1 set" : `${gone.length} sets`}: ${gone.join(", ")}`] : [], target };
  }

  const details: string[] = [];
  if (entryRow?.op === "UPDATE") {
    const [a, b] = [entryRow.before!, entryRow.after!];
    if (a.exercise_id !== b.exercise_id) {
      details.push(`${ctx.exerciseName(String(a.exercise_id)) ?? "an exercise"} → ${ctx.exerciseName(String(b.exercise_id)) ?? "another exercise"}`);
    }
    for (const [key, label] of [["variant", "variant"], ["notes", "notes"], ["tempo", "tempo"]] as const) {
      const line = textChange(label, a[key], b[key]);
      if (line) details.push(line);
    }
  }
  for (const c of bySet) {
    if (c.op === "UPDATE") details.push(`set ${setNo(c)}: ${fmtSet(c.before!)} → ${fmtSet(c.after!)}`);
    if (c.op === "INSERT") details.push(`added set ${setNo(c)}: ${fmtSet(c.after!)}`);
    if (c.op === "DELETE") details.push(`removed set ${setNo(c)}: ${fmtSet(c.before!)}`);
  }

  // The PRD's own example: "changed Bench Press set 2: 60 kg × 8 → 65 kg × 8".
  if (details.length === 1 && bySet.length === 1 && bySet[0].op === "UPDATE" && entryRow?.op !== "UPDATE") {
    return { what: `changed ${name} set ${setNo(bySet[0])}`, date, details: [`${fmtSet(bySet[0].before!)} → ${fmtSet(bySet[0].after!)}`], target };
  }
  return { what: `changed ${name}`, date, details, target };
}

function describeMeal(c: Change, whose: string): Described {
  const v = (c.after ?? c.before)!;
  const meal = `${whose} ${String(v.slot)} meal`;
  const base = { date: String(v.date), target: { table: "meals" as const, id: c.row_id } };
  if (c.op === "INSERT") return { ...base, what: `added ${meal}`, details: v.description ? [quote(v.description)] : [] };
  if (c.op === "DELETE") return { ...base, what: `deleted ${meal}`, details: [] };
  const [a, b] = [c.before!, c.after!];
  if (!a.deleted_at && b.deleted_at) return { ...base, what: `deleted ${meal}`, details: [] };
  if (a.deleted_at && !b.deleted_at) return { ...base, what: `restored ${meal}`, details: [] };
  const details = [textChange("food", a.description, b.description), textChange("notes", a.notes, b.notes)].filter((x): x is string => !!x);
  if (a.photo_path !== b.photo_path) details.push(!a.photo_path ? "added a photo" : !b.photo_path ? "removed the photo" : "changed the photo");
  return { ...base, what: `changed ${meal}`, details };
}

function describeSession(c: Change): Described | null {
  if (c.op !== "UPDATE") return null;   // a day started by a save isn't worth a line
  const [a, b] = [c.before!, c.after!];
  const date = String(b.date);
  if (!a.deleted_at && b.deleted_at) return { what: "deleted the workout", date, details: [], target: null };
  if (a.deleted_at && !b.deleted_at) return { what: "restored the workout", date, details: [], target: null };
  const details = [textChange("title", a.title, b.title), textChange("notes", a.notes, b.notes)].filter((x): x is string => !!x);
  return details.length ? { what: "changed the workout", date, details, target: null } : null;
}

/** One save's rows, as one line per exercise, meal or day it touched. */
export function describeGroup(group: Change[], ctx: ChangeContext): Described[] {
  const out: Described[] = [];
  const entries = new Map<string, { row?: Change; sets: Change[] }>();
  for (const c of group) {
    if (c.table_name === "session_exercises") {
      entries.set(c.row_id, { ...(entries.get(c.row_id) ?? { sets: [] }), row: c });
    } else if (c.table_name === "sets") {
      const id = String((c.after ?? c.before)?.session_exercise_id);
      const e = entries.get(id) ?? { sets: [] };
      entries.set(id, { ...e, sets: [...e.sets, c] });
    }
  }
  for (const c of group) {
    if (c.table_name === "meals") out.push(describeMeal(c, ctx.whose));
    if (c.table_name === "sessions") {
      const d = describeSession(c);
      if (d) out.push(d);
    }
  }
  for (const [id, { row, sets }] of entries) out.push(describeEntry(id, row, sets, ctx));
  return out;
}

/** "Coach Andi changed Bench Press set 2 on Tue 27 Oct: 60 kg × 8 → 65 kg × 8" */
export function sentence(actor: string, d: Described): string {
  const when = d.date ? ` on ${fmtDay(d.date)}` : "";
  return `${actor} ${d.what}${when}${d.details.length === 1 ? `: ${d.details[0]}` : ""}`;
}
