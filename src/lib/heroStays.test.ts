import { describe, expect, it } from "vitest";
import { isHeroPhoto } from "./heroStays";

describe("isHeroPhoto", () => {
  it("takes a large landscape photo", () => {
    expect(isHeroPhoto({ width: 2400, height: 1600 })).toBe(true);
  });
  it("refuses a small photo, however wide", () => {
    expect(isHeroPhoto({ width: 1200, height: 600 })).toBe(false);
  });
  it("refuses a large portrait or near-square photo", () => {
    expect(isHeroPhoto({ width: 2000, height: 3000 })).toBe(false);
    expect(isHeroPhoto({ width: 2000, height: 1800 })).toBe(false);
  });
});
