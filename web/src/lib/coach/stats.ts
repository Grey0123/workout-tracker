import { dateOf, keyOf, weekOf } from "../log/dates";

/** A client is flagged after this many days without a workout (PRD 5.3: "haven't logged in N days"). */
export const QUIET_DAYS = 4;

const daysBetween = (from: string, to: string) => Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / 864e5);

/**
 * For the client list, from distinct training days, newest first. The streak counts
 * weeks with at least one workout, because rest days would break a streak of days
 * for anyone lifting three times a week. This week counts once it has a workout.
 */
export function clientStats(days: string[], today: string) {
  const week = weekOf(today);
  const thisWeek = days.filter((d) => d >= week[0] && d <= week[6]).length;
  const last = days[0] ?? null;

  let streak = 0;
  const trained = new Set(days.map((d) => weekOf(d)[0]));
  const monday = dateOf(week[0]);
  for (let w = trained.has(week[0]) ? 0 : 1; ; w++) {
    const start = keyOf(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * w));
    if (!trained.has(start)) break;
    streak++;
  }

  const quiet = last ? daysBetween(last, today) : null;
  return { last, thisWeek, streak, quiet, flagged: quiet === null || quiet >= QUIET_DAYS };
}
