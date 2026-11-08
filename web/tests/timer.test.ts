import { describe, expect, it } from "vitest";
import { adjust, clock, readRest, restLabel, secondsLeft } from "../src/lib/log/timer";

describe("rest timer", () => {
  it("counts whole seconds to the end, and stops at zero", () => {
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 400)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 12_000)).toBe(0);
  });

  it("reads like a clock", () => {
    expect(clock(90)).toBe("1:30");
    expect(clock(5)).toBe("0:05");
    expect(restLabel(90)).toBe("90s");
    expect(restLabel(120)).toBe("2 min");
  });

  it("adds and takes off time, keeping a few seconds", () => {
    expect(adjust(60_000, 0, 15)).toBe(75_000);
    expect(adjust(60_000, 0, -15)).toBe(45_000);
    expect(adjust(8_000, 0, -15)).toBe(5_000);
  });

  it("only takes a length on offer from storage", () => {
    expect(readRest("120")).toBe(120);
    expect(readRest(null)).toBe(90);
    expect(readRest("7")).toBe(90);
  });
});
