import { describe, expect, it } from "vitest";
import { firstRotationDelay, hashSeed, wrapIndex } from "./imageRotation";

describe("wrapIndex", () => {
  it("loops forwards and backwards", () => {
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(1, 3)).toBe(1);
  });

  it("is safe with no photos", () => {
    expect(wrapIndex(5, 0)).toBe(0);
  });
});

describe("firstRotationDelay", () => {
  it("is stable for the same card", () => {
    expect(firstRotationDelay("listing-a", 5000)).toBe(firstRotationDelay("listing-a", 5000));
    expect(hashSeed("listing-a")).toBe(hashSeed("listing-a"));
  });

  it("stays between half an interval and one and a half", () => {
    for (const seed of ["a", "b", "cmabc123", "listing-xyz", ""]) {
      const delay = firstRotationDelay(seed, 5000);
      expect(delay).toBeGreaterThanOrEqual(2500);
      expect(delay).toBeLessThan(7500);
    }
  });

  it("spreads different cards out instead of firing together", () => {
    const delays = new Set(
      ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].map((seed) => firstRotationDelay(seed, 5000)),
    );
    expect(delays.size).toBeGreaterThanOrEqual(7);
  });
});
