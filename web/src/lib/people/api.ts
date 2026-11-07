import { createClient } from "@/lib/supabase/client";
import type { CoachAccess, Connection, ConnectionKind, Invite, InviteDetails, Person, Shares } from "./types";

export const CONNECTION_COLUMNS =
  "id, owner_id, viewer_id, kind, status, requested_by, coach_access, coach_access_set_at, created_at, " +
  "share_workouts, share_meals, share_meal_photos, share_bodyweight, share_progress_photos";
const PERSON_COLUMNS = "id, username, display_name, account_type";

/** The database answers with a short code. These say what it means. */
const MESSAGES: Record<string, string> = {
  has_coach: "You already have a coach. Confirm that the new one replaces them.",
  coach_notice: "Tick the notice about self-declared coaches first.",
  not_a_coach: "That isn't a coach account.",
  already_connected: "You're already connected, or a request is waiting for an answer.",
  already_coach: "They're already your coach, which includes everything a friend sees.",
  invite_invalid: "This invite link has expired or was already used. Ask for a new one.",
  own_invite: "This is your own invite link. Send it to the other person.",
  too_many_invites: "You have 20 open invite links. Cancel some first.",
  self: "That's you.",
  no_such_person: "There's no account with that username.",
};

export function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = Object.keys(MESSAGES).find((key) => message.includes(key));
  return code ? MESSAGES[code] : "Something went wrong. Check your connection and try again.";
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type PeopleData = { connections: Connection[]; people: Map<string, Person>; invites: Invite[] };

export async function loadPeople(me: string): Promise<PeopleData> {
  const db = createClient();
  const { data: connections, error } = await db
    .from("connections")
    .select(CONNECTION_COLUMNS)
    .in("status", ["pending", "active"])
    .or(`owner_id.eq.${me},viewer_id.eq.${me}`)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const list = (connections ?? []) as unknown as Connection[];

  const ids = [...new Set(list.map((c) => (c.owner_id === me ? c.viewer_id : c.owner_id)))];
  const [{ data: people, error: peopleError }, { data: invites, error: inviteError }] = await Promise.all([
    ids.length ? db.from("profiles").select(PERSON_COLUMNS).in("id", ids) : Promise.resolve({ data: [], error: null }),
    db
      .from("invites")
      .select("code, kind, inviter_shares, expires_at")
      .eq("created_by", me)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false }),
  ]);
  if (peopleError) throw new Error(peopleError.message);
  if (inviteError) throw new Error(inviteError.message);

  return {
    connections: list,
    people: new Map(((people ?? []) as Person[]).map((p) => [p.id, p])),
    invites: (invites ?? []) as Invite[],
  };
}

export async function findPerson(username: string): Promise<Person | null> {
  const found = await call<Person[]>("find_person", { p_username: username });
  return found[0] ?? null;
}

export type OwnerChoices = { notice?: boolean; replace?: boolean; shares?: Partial<Shares> };

export const requestConnection = (other: string, kind: ConnectionKind, iShare: boolean, choices: OwnerChoices = {}) =>
  call<string>("request_connection", {
    p_other: other,
    p_kind: kind,
    p_i_share: iShare,
    p_coach_notice: choices.notice ?? false,
    p_replace_coach: choices.replace ?? false,
    p_shares: choices.shares ?? null,
  });

export const respondConnection = (id: string, accept: boolean, choices: OwnerChoices = {}) =>
  call<void>("respond_connection", {
    p_id: id,
    p_accept: accept,
    p_coach_notice: choices.notice ?? false,
    p_replace_coach: choices.replace ?? false,
    p_shares: choices.shares ?? null,
  });

export const endConnection = (id: string) => call<void>("end_connection", { p_id: id });
export const updateSharing = (id: string, shares: Partial<Shares>) => call<void>("update_sharing", { p_id: id, p_shares: shares });
export const setCoachAccess = (id: string, access: CoachAccess) => call<void>("set_coach_access", { p_id: id, p_access: access });

export const createInvite = (kind: ConnectionKind, inviterShares: boolean, notice = false) =>
  call<string>("create_invite", { p_kind: kind, p_inviter_shares: inviterShares, p_coach_notice: notice });

export async function inviteDetails(code: string): Promise<InviteDetails | null> {
  const found = await call<InviteDetails[]>("invite_details", { p_code: code });
  return found[0] ?? null;
}

export const acceptInvite = (code: string, choices: OwnerChoices = {}) =>
  call<string>("accept_invite", {
    p_code: code,
    p_coach_notice: choices.notice ?? false,
    p_replace_coach: choices.replace ?? false,
    p_shares: choices.shares ?? null,
  });

export async function deleteInvite(code: string) {
  const { error } = await createClient().from("invites").delete().eq("code", code);
  if (error) throw new Error(error.message);
}

/** The coach the signed-in person has now, if any. */
export async function currentCoach(me: string): Promise<Person | null> {
  const db = createClient();
  const { data, error } = await db
    .from("connections")
    .select("viewer_id")
    .eq("owner_id", me)
    .eq("kind", "coach")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: coach } = await db.from("profiles").select(PERSON_COLUMNS).eq("id", data.viewer_id).maybeSingle();
  return (coach as Person | null) ?? null;
}

export const inviteUrl = (code: string) => `${window.location.origin}/invite/${code}`;
