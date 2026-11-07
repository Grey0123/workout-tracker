import { describe, expect, it } from "vitest";
import { clientStats } from "../src/lib/coach/stats";

describe("client list figures", () => {
  // Sunday 1 November 2026; that week starts Monday 26 October.
  const today = "2026-11-01";

  it("counts this week's workouts and the last one", () => {
    const s = clientStats(["2026-10-31", "2026-10-28", "2026-10-26", "2026-10-25"], today);
    expect(s).toMatchObject({ last: "2026-10-31", thisWeek: 3, quiet: 1, flagged: false });
  });

  it("counts a streak of weeks, including this week once it has a workout", () => {
    expect(clientStats(["2026-10-27", "2026-10-21", "2026-10-13"], today).streak).toBe(3);
    expect(clientStats(["2026-10-21", "2026-10-13"], today).streak).toBe(2);
    expect(clientStats(["2026-10-27", "2026-10-06"], today).streak).toBe(1);
  });

  it("flags a client who has gone quiet, or never logged", () => {
    expect(clientStats(["2026-10-28"], today)).toMatchObject({ quiet: 4, flagged: true });
    expect(clientStats([], today)).toMatchObject({ last: null, thisWeek: 0, streak: 0, quiet: null, flagged: true });
  });
});
