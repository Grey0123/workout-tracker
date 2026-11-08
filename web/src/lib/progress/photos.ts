// Progress photos side by side (PRD 5.4, Body). Relative imports, for the tests.
import { dateOf } from "../log/dates";
import type { Weight } from "./calc";

export type PhotoLike = { id: string; date: string; pose: string; created_at: string };

const byTime = (a: PhotoLike, b: PhotoLike) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at);

/** The poses there are photos of, most photographed first. */
export function posesOf(photos: PhotoLike[]): string[] {
  const counts = new Map<string, number>();
  for (const p of photos) counts.set(p.pose, (counts.get(p.pose) ?? 0) + 1);
  return [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!);
}

/**
 * The pair to compare by default: the first and last photo of the pose in the period.
 * With one photo in the period, the latest earlier photo comes first, so there's still
 * a before. Null when there's nothing to put side by side.
 */
export function defaultPair<T extends PhotoLike>(photos: T[], pose: string, start: string, end: string): [T, T] | null {
  const posed = photos.filter((p) => p.pose === pose).sort(byTime);
  const inPeriod = posed.filter((p) => p.date >= start && p.date <= end);
  if (inPeriod.length >= 2) return [inPeriod[0], inPeriod.at(-1)!];
  if (inPeriod.length === 1) {
    const before = posed.filter((p) => p.date < start).at(-1);
    return before ? [before, inPeriod[0]] : null;
  }
  return null;
}

/** The weigh-in closest to a day, within three days of it. */
export function weightNear(weights: Weight[], day: string): Weight | undefined {
  const at = dateOf(day).getTime();
  let best: Weight | undefined;
  let gap = 3.5 * 864e5;
  for (const w of weights) {
    const d = Math.abs(dateOf(w.date).getTime() - at);
    if (d <= gap) {
      best = w;
      gap = d;
    }
  }
  return best;
}

/** "6 weeks apart", "3 days apart", "same day". */
export function apart(a: string, b: string): string {
  const days = Math.round(Math.abs(dateOf(b).getTime() - dateOf(a).getTime()) / 864e5);
  if (days === 0) return "same day";
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"} apart`;
  if (days < 70) return `${Math.round(days / 7)} weeks apart`;
  return `${Math.round(days / 30.44)} months apart`;
}
