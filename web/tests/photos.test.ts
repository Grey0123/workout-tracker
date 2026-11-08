import { describe, expect, it } from "vitest";
import { apart, defaultPair, posesOf, weightNear } from "../src/lib/progress/photos";

let seq = 0;
const photo = (date: string, pose = "front") => ({ id: `p${++seq}`, date, pose, created_at: `${date}T10:00:${String(seq).padStart(2, "0")}Z` });

describe("progress photo pairs", () => {
  const photos = [photo("2026-09-01"), photo("2026-10-05"), photo("2026-10-20", "side"), photo("2026-10-26"), photo("2026-11-02"), photo("2026-11-02")];

  it("compare the first and last of a pose in the period", () => {
    const pair = defaultPair(photos, "front", "2026-10-01", "2026-11-08");
    expect(pair?.map((p) => p.date)).toEqual(["2026-10-05", "2026-11-02"]);
    // Two the same day: the later one is the after.
    expect(pair?.[1].id).toBe(photos[5].id);
  });

  it("reach back before the period when it holds only one", () => {
    expect(defaultPair(photos, "side", "2026-10-15", "2026-11-08")).toBeNull();
    expect(defaultPair(photos, "front", "2026-10-28", "2026-11-01")).toBeNull();
    expect(defaultPair([photo("2026-08-01"), photo("2026-10-10")], "front", "2026-10-01", "2026-10-31")?.map((p) => p.date)).toEqual(["2026-08-01", "2026-10-10"]);
  });

  it("list poses most photographed first", () => {
    expect(posesOf(photos)).toEqual(["front", "side"]);
  });
});

describe("weight beside a photo", () => {
  const weights = [{ date: "2026-11-01", kg: 86 }, { date: "2026-11-05", kg: 85.4 }];
  it("is the nearest weigh-in within three days", () => {
    expect(weightNear(weights, "2026-11-04")?.kg).toBe(85.4);
    expect(weightNear(weights, "2026-11-02")?.kg).toBe(86);
    expect(weightNear(weights, "2026-11-12")).toBeUndefined();
  });
});

describe("time between photos", () => {
  it("reads naturally", () => {
    expect(apart("2026-11-02", "2026-11-02")).toBe("same day");
    expect(apart("2026-11-01", "2026-11-04")).toBe("3 days apart");
    expect(apart("2026-09-20", "2026-11-01")).toBe("6 weeks apart");
    expect(apart("2026-05-01", "2026-11-01")).toBe("6 months apart");
  });
});
