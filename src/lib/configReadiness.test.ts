import { describe, expect, it } from "vitest";
import { configReadiness, readinessSummary } from "@/lib/configReadiness";

const complete = {
  VERCEL_ENV: "production",
  DATABASE_URL: "postgres://x",
  AUTH_SECRET: "x",
  STRIPE_SECRET_KEY: "sk_live_x",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_y",
  RESEND_API_KEY: "re_x",
  EMAIL_FROM: "FYStay <hello@fystay.co.uk>",
  NEXT_PUBLIC_BASE_URL: "https://fystay.co.uk",
  CRON_SECRET: "x",
  TWO_FACTOR_ENCRYPTION_KEY: "x",
  SUPABASE_SERVICE_ROLE_KEY: "x",
  SENTRY_DSN: "x",
  NEXT_PUBLIC_SENTRY_DSN: "x",
  DISPUTE_ALERT_EMAIL: "ops@fystay.co.uk",
  NEXT_PUBLIC_COMPANY_LEGAL_NAME: "FYStay Ltd",
};

describe("configReadiness", () => {
  it("is ready when everything is set", () => {
    expect(readinessSummary(configReadiness(complete))).toEqual({ ready: true, blockers: [], warnings: [] });
  });

  it("blocks a test Stripe key in production, but not on Preview", () => {
    const test = { ...complete, STRIPE_SECRET_KEY: "sk_test_x" };
    expect(readinessSummary(configReadiness(test)).blockers.map((b) => b.key)).toEqual(["STRIPE_SECRET_KEY is live"]);
    expect(readinessSummary(configReadiness({ ...test, VERCEL_ENV: "preview" })).ready).toBe(true);
  });

  it("blocks Resend's test sender and a missing sender", () => {
    for (const EMAIL_FROM of ["FYStay <onboarding@resend.dev>", undefined]) {
      const summary = readinessSummary(configReadiness({ ...complete, EMAIL_FROM }));
      expect(summary.blockers.map((b) => b.key)).toEqual(["EMAIL_FROM on your own domain"]);
    }
  });

  it("treats monitoring gaps as warnings, not blockers", () => {
    const summary = readinessSummary(configReadiness({ ...complete, SENTRY_DSN: " ", DISPUTE_ALERT_EMAIL: undefined }));
    expect(summary.ready).toBe(true);
    expect(summary.warnings.map((w) => w.key)).toEqual(["SENTRY_DSN", "DISPUTE_ALERT_EMAIL"]);
  });
});
