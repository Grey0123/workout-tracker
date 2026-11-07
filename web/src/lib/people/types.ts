export type ConnectionKind = "friend" | "coach";
export type CoachAccess = "add_edit" | "full";

export type ShareKey = "share_workouts" | "share_meals" | "share_meal_photos" | "share_bodyweight" | "share_progress_photos";
export type Shares = Record<ShareKey, boolean>;

/** The ones there's something to see for. Progress photos get their screen later. */
export const SHARE_OPTIONS: { key: ShareKey; label: string; needs?: ShareKey }[] = [
  { key: "share_workouts", label: "Workouts" },
  { key: "share_meals", label: "Meals" },
  { key: "share_meal_photos", label: "Meal photos", needs: "share_meals" },
  { key: "share_bodyweight", label: "Body weight" },
];

/** Mirrors default_shares() in the sharing migration. */
export const DEFAULT_SHARES: Record<ConnectionKind, Shares> = {
  friend: { share_workouts: true, share_meals: false, share_meal_photos: false, share_bodyweight: false, share_progress_photos: false },
  coach: { share_workouts: true, share_meals: true, share_meal_photos: true, share_bodyweight: true, share_progress_photos: false },
};

export type Person = {
  id: string;
  username: string;
  display_name: string;
  account_type: "user" | "coach";
};

/** One-way: the owner shares their log with the viewer. */
export type Connection = Shares & {
  id: string;
  owner_id: string;
  viewer_id: string;
  kind: ConnectionKind;
  status: "pending" | "active" | "revoked";
  requested_by: string | null;
  coach_access: CoachAccess;
  coach_access_set_at: string | null;
  created_at: string;
};

export type Invite = {
  code: string;
  kind: ConnectionKind;
  inviter_shares: boolean;
  expires_at: string;
};

export type InviteDetails = {
  username: string;
  display_name: string;
  account_type: "user" | "coach";
  kind: ConnectionKind;
  inviter_shares: boolean;
  expires_at: string;
  usable: boolean;
  mine: boolean;
};

export const COACH_LABEL = "Self-declared coach, not verified or certified by WorkoutTracker";
