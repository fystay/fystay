import { beforeEach, describe, expect, it, vi } from "vitest";

const { retrieve, userUpdate } = vi.hoisted(() => ({ retrieve: vi.fn(), userUpdate: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: userUpdate } } }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({ v2: { core: { accounts: { retrieve } } } }) }));

import { loadConnectAccountStatus } from "./stripeConnect";

const account = (transfers: string, entries: unknown[]) => ({
  configuration: {
    recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: transfers, status_details: [] } } } },
  },
  requirements: { entries },
});
const due = { awaiting_action_from: "user", description: "Add a bank account", errors: [], minimum_deadline: { status: "currently_due" } };

beforeEach(() => {
  retrieve.mockReset();
  userUpdate.mockReset();
});

describe("loadConnectAccountStatus", () => {
  it("counts details as submitted the moment Stripe has nothing left to ask, before payouts switch on", async () => {
    retrieve.mockResolvedValue(account("pending", []));
    const result = await loadConnectAccountStatus("acct_1");
    expect(result?.flags).toEqual({
      stripeConnectDetailsSubmitted: true,
      stripeConnectChargesEnabled: false,
      stripeConnectPayoutsEnabled: false,
    });
    expect(userUpdate).toHaveBeenCalledWith({ where: { stripeConnectAccountId: "acct_1" }, data: result?.flags });
  });

  it("doesn't while the host still owes Stripe details", async () => {
    retrieve.mockResolvedValue(account("pending", [due]));
    const result = await loadConnectAccountStatus("acct_1");
    expect(result?.flags.stripeConnectDetailsSubmitted).toBe(false);
    expect(result?.requirements.due).toEqual(["Add a bank account"]);
  });

  it("marks payouts ready only when Stripe says transfers are active", async () => {
    retrieve.mockResolvedValue(account("active", []));
    const result = await loadConnectAccountStatus("acct_1");
    expect(result?.flags).toEqual({
      stripeConnectDetailsSubmitted: true,
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    });
  });
});
