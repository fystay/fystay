import { afterEach, describe, expect, it, vi } from "vitest";
import { getStripeClient, stripeKeyMatchesEnvironment } from "./stripe";

describe("stripeKeyMatchesEnvironment", () => {
  const production = { VERCEL_ENV: "production" };
  const preview = { VERCEL_ENV: "preview" };
  const local = {};

  it("accepts only live keys on Production", () => {
    expect(stripeKeyMatchesEnvironment("sk_live_abc", production)).toBe(true);
    expect(stripeKeyMatchesEnvironment("rk_live_abc", production)).toBe(true);
    expect(stripeKeyMatchesEnvironment("sk_test_abc", production)).toBe(false);
    expect(stripeKeyMatchesEnvironment("rk_test_abc", production)).toBe(false);
  });

  it("never accepts a live key on Preview, locally or in CI", () => {
    for (const env of [preview, local]) {
      expect(stripeKeyMatchesEnvironment("sk_live_abc", env)).toBe(false);
      expect(stripeKeyMatchesEnvironment("sk_test_abc", env)).toBe(true);
    }
  });
});

describe("getStripeClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("treats a test key on Production as no key, so payments are refused rather than taken in test mode", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc");
    expect(getStripeClient()).toBeNull();
  });

  it("ignores a live key on Preview", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
    expect(getStripeClient()).toBeNull();
  });

  it("uses a test key on Preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc");
    expect(getStripeClient()).not.toBeNull();
  });
});
