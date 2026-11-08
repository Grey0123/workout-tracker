// The rest timer's arithmetic. It counts to a moment rather than ticking down, so a
// phone that sleeps or a tab in the background still shows the right time.

/** The lengths offered, in seconds. */
export const REST_CHOICES = [60, 90, 120, 180] as const;
export const DEFAULT_REST = 90;

export const restLabel = (seconds: number) => (seconds < 120 ? `${seconds}s` : `${seconds / 60} min`);

/** Whole seconds left, never below zero. */
export const secondsLeft = (endsAt: number, now: number) => Math.max(0, Math.ceil((endsAt - now) / 1000));

export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Moves the end by some seconds, keeping at least five seconds to go. */
export const adjust = (endsAt: number, now: number, by: number) => Math.max(now + 5000, endsAt + by * 1000);

/** A saved length, or the default when it's missing or not one on offer. */
export function readRest(saved: string | null): number {
  const n = Number(saved);
  return (REST_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_REST;
}
