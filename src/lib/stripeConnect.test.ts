import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  bookableHostWhere,
  connectFlagsFromV2Account,
  connectRequirementsFromV2Account,
  destinationChargeData,
  hostConnectAccountParams,
  isConnectReady,
} from "./stripeConnect";

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
    const params = hostConnectAccountParams({ userId: "user_1", email: "host@example.com", name: "Sam" });
    expect(params.dashboard).toBe("express");
    expect(params.defaults?.responsibilities).toEqual({ fees_collector: "application", losses_collector: "application" });
    expect(params.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.requested).toBe(true);
    expect(params.configuration?.merchant).toBeUndefined();
    expect(params.metadata).toEqual({ fystay_user_id: "user_1" });
  });
});

describe("connectRequirementsFromV2Account", () => {
  type Entry = NonNullable<NonNullable<Stripe.V2.Core.Account["requirements"]>["entries"]>[number];
  const entry = (overrides: Partial<Entry>): Entry =>
    ({
      awaiting_action_from: "user",
      description: "Provide your date of birth",
      errors: [],
      impact: {},
      minimum_deadline: { status: "currently_due" },
      requested_reasons: [],
      ...overrides,
    }) as Entry;
  const account = (entries: Entry[]) => ({ requirements: { entries } }) as unknown as Stripe.V2.Core.Account;

  it("lists what the host still has to give Stripe, once each", () => {
    const result = connectRequirementsFromV2Account(
      account([entry({}), entry({}), entry({ description: "Add a bank account" })]),
    );
    expect(result).toEqual({
      due: ["Provide your date of birth", "Add a bank account"],
      overdue: false,
      reviewing: false,
      rejected: false,
    });
  });

  it("flags overdue and rejected details", () => {
    const result = connectRequirementsFromV2Account(
      account([
        entry({ minimum_deadline: { status: "past_due" } }),
        entry({
          description: "Upload an ID document",
          errors: [{ code: "verification_document_expired", description: "expired" }],
        }),
      ]),
    );
    expect(result.overdue).toBe(true);
    expect(result.rejected).toBe(true);
  });

  it("says Stripe is reviewing when only Stripe has something to do", () => {
    const result = connectRequirementsFromV2Account(account([entry({ awaiting_action_from: "stripe" })]));
    expect(result).toEqual({ due: [], overdue: false, reviewing: true, rejected: false });
  });

  it("is empty when Stripe needs nothing", () => {
    expect(connectRequirementsFromV2Account({} as Stripe.V2.Core.Account)).toEqual({
      due: [],
      overdue: false,
      reviewing: false,
      rejected: false,
    });
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

describe("destinationChargeData", () => {
  it("sends the whole payment to the host and takes FYStay's fee back: £435 -> £43.50 fee", () => {
    expect(destinationChargeData("acct_host", 4_350)).toEqual({
      application_fee_amount: 4_350,
      transfer_data: { destination: "acct_host" },
    });
  });

  it("sends no fee at all when promos or credit used up the whole commission", () => {
    expect(destinationChargeData("acct_host", 0)).toEqual({ transfer_data: { destination: "acct_host" } });
  });

  it("never sends a negative fee", () => {
    expect(destinationChargeData("acct_host", -5)).toEqual({ transfer_data: { destination: "acct_host" } });
  });
});
