import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { bookableHostWhere, connectFlagsFromV2Account, hostConnectAccountParams, isConnectReady } from "./stripeConnect";

type Status = "active" | "pending" | "restricted" | "unsupported";

function account(transfers?: Status, details: string[] = [], payouts?: Status): Stripe.V2.Core.Account {
  return {
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            ...(transfers && {
              stripe_transfers: {
                status: transfers,
                status_details: details.map((code) => ({ code, resolution: "provide_info" })),
              },
            }),
            ...(payouts && { payouts: { status: payouts, status_details: [] } }),
          },
        },
      },
    },
  } as unknown as Stripe.V2.Core.Account;
}

describe("connectFlagsFromV2Account", () => {
  it("is ready only when the recipient's stripe_transfers capability is active", () => {
    const flags = connectFlagsFromV2Account(account("active"));
    expect(flags).toEqual({
      stripeConnectDetailsSubmitted: true,
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    });
    expect(isConnectReady(flags)).toBe(true);
  });

  it("is not ready while onboarding is incomplete or the account has no recipient configuration", () => {
    for (const a of [account("restricted", ["requirements_past_due"]), account()]) {
      const flags = connectFlagsFromV2Account(a);
      expect(isConnectReady(flags)).toBe(false);
      expect(flags.stripeConnectDetailsSubmitted).toBe(false);
    }
  });

  it("counts details as submitted while Stripe verifies them", () => {
    const flags = connectFlagsFromV2Account(account("pending", ["requirements_pending_verification"]));
    expect(flags.stripeConnectDetailsSubmitted).toBe(true);
    expect(isConnectReady(flags)).toBe(false);
  });

  it("holds payouts back when Stripe reports bank payouts as not yet active", () => {
    const flags = connectFlagsFromV2Account(account("active", [], "restricted"));
    expect(flags.stripeConnectPayoutsEnabled).toBe(false);
    expect(isConnectReady(flags)).toBe(false);
  });
});

describe("hostConnectAccountParams", () => {
  it("creates a marketplace recipient: Express dashboard, platform owns fees and losses, transfers only", () => {
    const params = hostConnectAccountParams({ email: "host@example.com", name: "Sam" });
    expect(params.dashboard).toBe("express");
    expect(params.defaults?.responsibilities).toEqual({ fees_collector: "application", losses_collector: "application" });
    expect(params.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.requested).toBe(true);
    expect(params.configuration?.merchant).toBeUndefined();
  });
});

describe("bookableHostWhere", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("shows guests only listings whose host can be paid once Stripe is live", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    expect(bookableHostWhere()).toEqual({
      host: { stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true },
    });
  });

  it("filters nothing without a Stripe key, where bookings confirm without payment", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(bookableHostWhere()).toEqual({});
  });
});
