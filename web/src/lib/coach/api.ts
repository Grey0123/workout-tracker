import { weekOf } from "@/lib/log/dates";
import type { Person } from "@/lib/people/types";
import { createClient } from "@/lib/supabase/client";
import type { Change } from "./changes";

export type NoteKind = "private" | "reminder" | "goal" | "weekly_plan" | "day";

export const NOTE_KINDS: { value: NoteKind; label: string; detail: string }[] = [
  { value: "private", label: "Private note", detail: "Only you see it" },
  { value: "reminder", label: "Reminder", detail: "They can tick it done" },
  { value: "goal", label: "Current goal", detail: "Pinned on their Home" },
  { value: "weekly_plan", label: "Weekly plan", detail: "Pinned on that week in their calendar" },
  { value: "day", label: "Day note", detail: "On that day in their calendar" },
];

export type Note = {
  id: string;
  coach_id: string;
  user_id: string;
  kind: NoteKind;
  body: string;
  date: string | null;
  week_start: string | null;
  done_at: string | null;
  created_at: string;
  /** A goal can name an exercise and a target estimated 1RM, for the progress bar. */
  goal_exercise_id: string | null;
  goal_target_kg: number | null;
};

const NOTE_COLUMNS = "id, coach_id, user_id, kind, body, date, week_start, done_at, created_at, goal_exercise_id, goal_target_kg";

async function check<T>(call: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await call;
  if (error) throw new Error(error.message);
  return data as T;
}

/** Notes about this person. RLS returns a coach their own, and the client everything but private ones. */
export const loadNotes = (userId: string) =>
  check<Note[]>(createClient().from("coach_notes").select(NOTE_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }));

export type NoteInput = Pick<Note, "kind" | "body" | "date" | "week_start"> & Partial<Pick<Note, "goal_exercise_id" | "goal_target_kg">>;

export async function saveNote(coachId: string, userId: string, id: string | null, input: NoteInput): Promise<Note> {
  const db = createClient();
  const goal = input.kind === "goal" && input.goal_exercise_id && input.goal_target_kg;
  const row = {
    ...input,
    date: input.kind === "day" ? input.date : null,
    week_start: input.kind === "weekly_plan" ? input.week_start : null,
    goal_exercise_id: goal ? input.goal_exercise_id : null,
    goal_target_kg: goal ? input.goal_target_kg : null,
  };
  return check<Note>(
    id
      ? db.from("coach_notes").update(row).eq("id", id).select(NOTE_COLUMNS).single()
      : db.from("coach_notes").insert({ ...row, coach_id: coachId, user_id: userId }).select(NOTE_COLUMNS).single(),
  );
}

export async function deleteNote(id: string) {
  await check(createClient().from("coach_notes").delete().eq("id", id));
}

export async function setReminderDone(id: string, done: boolean) {
  await check(createClient().rpc("set_reminder_done", { p_id: id, p_done: done }));
}

/** The plan for the week holding this day. */
export const planFor = (notes: Note[], day: string) => notes.find((n) => n.kind === "weekly_plan" && n.week_start === weekOf(day)[0]);
export const currentGoal = (notes: Note[]) => notes.find((n) => n.kind === "goal");

/* ------------------------------------------------------------------ history */

type HistoryRow = Omit<Change, "tx"> & { tx: number | string };
const asChange = (r: HistoryRow): Change => ({ ...r, tx: String(r.tx) });

export async function loadHistory(table: "session_exercises" | "meals", id: string): Promise<Change[]> {
  const rows = await check<HistoryRow[]>(createClient().rpc("history_for", { p_table: table, p_id: id }));
  return rows.map(asChange);
}

/** What a coach changed in one client's log, newest first. */
export async function loadMyChanges(me: string, clientId: string, limit = 80): Promise<Change[]> {
  const rows = await check<HistoryRow[]>(
    createClient()
      .from("edit_history")
      .select("id, table_name, op, row_id, changed_by, changed_at, tx, before, after")
      .eq("owner_id", clientId)
      .eq("changed_by", me)
      .order("changed_at", { ascending: false })
      .limit(limit),
  );
  return rows.map(asChange);
}

export async function undoChanges(historyIds: string[]) {
  await check(createClient().rpc("undo_changes", { p_ids: historyIds }));
}

export function undoError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("changed_since")) return "That's been changed again since, so it can't be undone. Edit it directly instead.";
  return "Couldn't undo that. Check your connection and try again.";
}

/* ------------------------------------------------------------ notifications */

/** Tells the header to refresh its unread count. */
export const NOTIFICATIONS_READ = "workouttracker:notifications-read";

export type Notification = {
  id: string;
  type: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export const loadNotifications = (limit = 150) =>
  check<Notification[]>(
    createClient()
      .from("notifications")
      .select("id, type, actor_id, payload, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
  );

export async function unreadCount(): Promise<number> {
  const { count, error } = await createClient().from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function markRead(ids?: string[]) {
  let query = createClient().from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (ids) query = query.in("id", ids);
  await check(query);
}

/** A coach change notification as a history row, so it reads and undoes like one. */
export const notificationChange = (n: Notification): Change => ({
  id: String(n.payload.history_id ?? n.id),
  table_name: String(n.payload.table),
  op: n.payload.op as Change["op"],
  row_id: String(n.payload.row_id),
  changed_by: n.actor_id,
  changed_at: n.created_at,
  tx: String(n.payload.tx ?? n.created_at),
  before: (n.payload.before as Change["before"]) ?? null,
  after: (n.payload.after as Change["after"]) ?? null,
});

/* ------------------------------------------------------------------ clients */

export type ClientSummary = {
  person: Person;
  connectionId: string;
  since: string;
  access: "add_edit" | "full";
  sharesWorkouts: boolean;
  /** Distinct training days, newest first, over the last 26 weeks. */
  days: string[];
};

export async function loadClients(me: string): Promise<ClientSummary[]> {
  const db = createClient();
  const connections = await check<
    { id: string; owner_id: string; created_at: string; coach_access: "add_edit" | "full"; share_workouts: boolean }[]
  >(
    db
      .from("connections")
      .select("id, owner_id, created_at, coach_access, share_workouts")
      .eq("viewer_id", me)
      .eq("kind", "coach")
      .eq("status", "active"),
  );
  if (!connections.length) return [];
  const ids = connections.map((c) => c.owner_id);
  const since = new Date(Date.now() - 26 * 7 * 864e5).toISOString().slice(0, 10);
  const [people, sessions] = await Promise.all([
    check<Person[]>(db.from("profiles").select("id, username, display_name, account_type").in("id", ids)),
    // Days with an exercise in them, so a day whose exercises were all deleted doesn't count.
    check<{ sessions: { user_id: string; date: string } }[]>(
      db
        .from("session_exercises")
        .select("sessions!inner(user_id, date)")
        .in("sessions.user_id", ids)
        .is("sessions.deleted_at", null)
        .gte("sessions.date", since)
        .limit(10000) as unknown as PromiseLike<{ data: { sessions: { user_id: string; date: string } }[] | null; error: { message: string } | null }>,
    ),
  ]);
  return connections
    .map((c) => {
      const person = people.find((p) => p.id === c.owner_id);
      if (!person) return null;
      const days = [...new Set(sessions.filter((s) => s.sessions.user_id === c.owner_id).map((s) => s.sessions.date))].sort().reverse();
      return { person, connectionId: c.id, since: c.created_at, access: c.coach_access, sharesWorkouts: c.share_workouts, days };
    })
    .filter((c): c is ClientSummary => !!c);
}
