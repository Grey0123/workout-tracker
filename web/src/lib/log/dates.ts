/** Dates are local-time "YYYY-MM-DD" keys, as in v1, so a late session stays on its own day. */

const pad = (n: number) => String(n).padStart(2, "0");

export const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => keyOf(new Date());

export function dateOf(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const niceDate = (key: string, options: Intl.DateTimeFormatOptions) =>
  dateOf(key).toLocaleDateString("en-GB", options);

export const longDate = (key: string) =>
  niceDate(key, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const dayMonth = (key: string) => niceDate(key, { day: "numeric", month: "short" });
export const dayMonthYear = (key: string) => niceDate(key, { day: "numeric", month: "short", year: "numeric" });
export const panelDate = (key: string) => niceDate(key, { weekday: "short", day: "numeric", month: "long" });

/** The seven keys of the Monday-first week holding this day. */
export function weekOf(key: string): string[] {
  const d = dateOf(key);
  const monday = d.getDate() - ((d.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, i) => keyOf(new Date(d.getFullYear(), d.getMonth(), monday + i)));
}

/** Six Monday-first weeks covering the month holding this day. */
export function monthGrid(key: string): string[] {
  const d = dateOf(key);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = 1 - ((first.getDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, i) => keyOf(new Date(d.getFullYear(), d.getMonth(), start + i)));
}

/** The first of the month, n months from this day's month. */
export function shiftMonth(key: string, n: number): string {
  const d = dateOf(key);
  return keyOf(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

export const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);
