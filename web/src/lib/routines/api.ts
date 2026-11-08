import { createClient } from "@/lib/supabase/client";
import type { Plan, Routine, RoutineItem } from "./plan";

const ITEM_COLUMNS = "exercise_id, variant, target_sets, target_reps, target_tempo, notes, position";

type ItemRow = RoutineItem & { position: number };
const ordered = (items: ItemRow[]): RoutineItem[] =>
  [...items]
    .sort((a, b) => a.position - b.position)
    .map((i) => ({
      exercise_id: i.exercise_id,
      variant: i.variant,
      target_sets: i.target_sets,
      target_reps: i.target_reps,
      target_tempo: i.target_tempo,
      notes: i.notes,
    }));

async function check<T>(call: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await call;
  if (error) throw new Error(error.message);
  return data as T;
}

/** Your own routines. Nobody else can read them, not even your clients. */
export async function loadRoutines(): Promise<Routine[]> {
  const rows = await check<(Omit<Routine, "items"> & { template_items: ItemRow[] })[]>(
    createClient().from("templates").select(`id, name, notes, updated_at, template_items(${ITEM_COLUMNS})`).order("name"),
  );
  return rows.map(({ template_items, ...r }) => ({ ...r, items: ordered(template_items) }));
}

/** Plans on this person's days, when you may see their workouts. */
export async function loadPlans(userId: string): Promise<Plan[]> {
  const rows = await check<(Omit<Plan, "items"> & { assignment_items: ItemRow[] })[]>(
    createClient()
      .from("assignments")
      .select(`id, date, name, notes, template_id, assigned_by, skipped_at, assignment_items(${ITEM_COLUMNS})`)
      .eq("user_id", userId)
      .order("date"),
  );
  return rows.map(({ assignment_items, ...p }) => ({ ...p, items: ordered(assignment_items) }));
}

export async function saveRoutine(id: string | null, name: string, notes: string | null, items: RoutineItem[]): Promise<string> {
  return check<string>(createClient().rpc("save_routine", { p_id: id, p_name: name, p_notes: notes, p_items: items }));
}

export async function deleteRoutine(id: string) {
  await check(createClient().from("templates").delete().eq("id", id));
}

export async function planRoutine(templateId: string, userId: string, date: string, replace = false): Promise<string> {
  return check<string>(
    createClient().rpc("plan_routine", { p_template_id: templateId, p_user_id: userId, p_date: date, p_replace: replace }),
  );
}

export async function removePlan(id: string) {
  await check(createClient().rpc("remove_plan", { p_id: id }));
}

export async function skipPlan(id: string, skipped: boolean) {
  await check(createClient().rpc("skip_plan", { p_id: id, p_skipped: skipped }));
}

/** What to tell the person when a routine or plan can't be saved. */
export function routineError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("templates_name")) return "You already have a routine with that name.";
  if (message.includes("empty_routine")) return "Add at least one exercise.";
  if (message.includes("too_many_items")) return "A routine can hold up to 40 exercises.";
  if (message.includes("already_planned")) return "That day already has a plan.";
  if (message.includes("not_allowed")) return "You can't change plans on this log.";
  if (message.includes("row-level security")) return "One of those exercises can't go in your routine.";
  return "That didn't save. Check your connection and try again.";
}
