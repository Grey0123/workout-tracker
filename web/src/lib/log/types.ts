export const CATEGORIES = [
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Forearms & grip",
  "Quads",
  "Hamstrings",
  "Glutes & hips",
  "Calves",
  "Core & abs",
  "Full body & conditioning",
  "Cardio",
  "Sports & classes",
  "Mobility & recovery",
] as const;

export const EQUIPMENT = [
  "None",
  "Barbell",
  "Dumbbell",
  "EZ bar",
  "Kettlebell",
  "Machine",
  "Smith machine",
  "Cable",
  "Resistance band",
  "Pull-up bar",
  "Medicine ball",
  "Sandbag",
  "Sled",
  "Cardio machine",
  "Other",
] as const;

export const MEAL_SLOTS = ["morning", "afternoon", "evening"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export type ExerciseKind = "weighted" | "bodyweight" | "timed" | "cardio" | "session" | "custom";
export type Side = "left" | "right";

/** The numbers a set can hold. Tempo is a variable too, but it's text. */
export type Metric = "weight_kg" | "reps" | "duration_s" | "distance_km" | "rounds" | "rpe" | "calories";
export type Variable = Metric | "tempo";

export const VARIABLES: { id: Variable; label: string; unit: string }[] = [
  { id: "weight_kg", label: "Weight", unit: "kg" },
  { id: "reps", label: "Reps", unit: "count" },
  { id: "duration_s", label: "Time", unit: "mm:ss" },
  { id: "distance_km", label: "Distance", unit: "km" },
  { id: "rounds", label: "Rounds", unit: "count" },
  { id: "tempo", label: "Tempo", unit: "e.g. 3-1-1-0" },
  { id: "rpe", label: "Effort (RPE)", unit: "1 to 10" },
  { id: "calories", label: "Calories", unit: "kcal" },
];

/** The order number fields appear in a set row. */
export const METRICS: Metric[] = ["weight_kg", "reps", "duration_s", "distance_km", "rounds", "rpe", "calories"];

export const PRESETS: { label: string; kind: ExerciseKind; inputs: Variable[] }[] = [
  { label: "Weights & reps", kind: "weighted", inputs: ["weight_kg", "reps"] },
  { label: "Bodyweight reps", kind: "bodyweight", inputs: ["reps"] },
  { label: "Timed hold", kind: "timed", inputs: ["duration_s"] },
  { label: "Cardio", kind: "cardio", inputs: ["duration_s", "distance_km"] },
  { label: "Duration only", kind: "session", inputs: ["duration_s"] },
];

export type Exercise = {
  id: string;
  name: string;
  category: string;
  secondary_muscles: string[];
  equipment: string | null;
  kind: ExerciseKind;
  inputs: Variable[];
  per_side: boolean;
  /** The weight is the help a machine gives: less is better, and it isn't weight lifted. */
  assisted: boolean;
  is_custom: boolean;
  created_by: string | null;
};

/** Offered in the variant box after what the person has written before. */
export const COMMON_VARIANTS = [
  "Machine",
  "Cable",
  "Dumbbell",
  "Barbell",
  "Smith machine",
  "Single arm",
  "Close grip",
  "Wide grip",
  "Incline",
  "Decline",
  "Paused",
];

export type SetValues = {
  weight_kg: number | null;
  reps: number | null;
  duration_s: number | null;
  distance_km: number | null;
  rounds: number | null;
  rpe: number | null;
  calories: number | null;
  tempo: string | null;
  side: Side | null;
};

/** One exercise logged on one day, with its sets in order. */
export type Entry = {
  id: string;
  date: string;
  exercise_id: string;
  position: number;
  variant: string | null;
  notes: string | null;
  tempo: string | null;
  sets: SetValues[];
  /** Shown straight away, not yet confirmed by the database. */
  saving?: boolean;
};

export type Meal = {
  id: string;
  date: string;
  slot: MealSlot;
  description: string | null;
  notes: string | null;
  photo_path: string | null;
  /** A local preview of a photo still uploading. */
  photo_preview?: string;
  saving?: boolean;
};

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  account_type: "user" | "coach";
};
