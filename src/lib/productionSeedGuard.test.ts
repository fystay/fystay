import { describe, expect, it } from "vitest";
import { isProductionSeedRefused } from "./productionSeedGuard";

describe("isProductionSeedRefused", () => {
  it("refuses on a production deployment by default", () => {
    expect(isProductionSeedRefused({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("refuses on production for any override value other than exactly 'true'", () => {
    for (const value of ["1", "yes", "TRUE", "", " true"]) {
      expect(isProductionSeedRefused({ VERCEL_ENV: "production", ALLOW_PRODUCTION_SEED: value })).toBe(true);
    }
  });

  it("allows production only with the explicit ALLOW_PRODUCTION_SEED=true override", () => {
    expect(isProductionSeedRefused({ VERCEL_ENV: "production", ALLOW_PRODUCTION_SEED: "true" })).toBe(false);
  });

  it("allows preview, development, and local runs with no VERCEL_ENV", () => {
    expect(isProductionSeedRefused({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isProductionSeedRefused({ VERCEL_ENV: "development" })).toBe(false);
    expect(isProductionSeedRefused({})).toBe(false);
  });
});
