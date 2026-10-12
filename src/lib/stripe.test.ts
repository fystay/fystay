import { afterEach, describe, expect, it, vi } from "vitest";
import { getStripeClient, getStripeClientForNewCharge, stripeKeyMatchesEnvironment } from "./stripe";

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

describe("stripeDashboardPaymentUrl", () => {
  it("points test payments at Stripe's test area and live ones at live", async () => {
    const { stripeDashboardPaymentUrl } = await import("./stripe");
    expect(stripeDashboardPaymentUrl("pi_1", { STRIPE_SECRET_KEY: "sk_test_x" } as never)).toBe(
      "https://dashboard.stripe.com/test/payments/pi_1",
    );
    expect(stripeDashboardPaymentUrl("pi_1", { STRIPE_SECRET_KEY: "sk_live_x" } as never)).toBe(
      "https://dashboard.stripe.com/payments/pi_1",
    );
  });
});

describe("getStripeClientForNewCharge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function production(company: { name?: string; address?: string }) {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
    vi.stubEnv("NEXT_PUBLIC_COMPANY_LEGAL_NAME", company.name ?? "");
    vi.stubEnv("NEXT_PUBLIC_COMPANY_ADDRESS", company.address ?? "");
  }

  it("refuses new live payments on Production without the trader's legal name", () => {
    production({ address: "1 High Street, Blackpool FY1 1AA" });
    expect(getStripeClientForNewCharge()).toBeNull();
  });

  it("refuses new live payments on Production without the trader's address, blank counting as missing", () => {
    production({ name: "FYStay Ltd", address: "   " });
    expect(getStripeClientForNewCharge()).toBeNull();
  });

  it("never logs the configured values", () => {
    production({ name: "Secret Name Ltd" });
    getStripeClientForNewCharge();
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("NEXT_PUBLIC_COMPANY_ADDRESS");
    expect(logged).not.toContain("Secret Name");
    expect(logged).not.toContain("sk_live_abc");
  });

  it("allows them on Production once both are set", () => {
    production({ name: "FYStay Ltd", address: "1 High Street, Blackpool FY1 1AA" });
    expect(getStripeClientForNewCharge()).not.toBeNull();
  });

  it("is unchanged on Preview and locally: no trader identity needed", () => {
    for (const env of ["preview", ""]) {
      vi.stubEnv("VERCEL_ENV", env);
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc");
      vi.stubEnv("NEXT_PUBLIC_COMPANY_LEGAL_NAME", "");
      vi.stubEnv("NEXT_PUBLIC_COMPANY_ADDRESS", "");
      expect(getStripeClientForNewCharge()).not.toBeNull();
    }
  });
});
