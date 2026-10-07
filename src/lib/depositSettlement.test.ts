import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const { opsAlert } = vi.hoisted(() => ({ opsAlert: vi.fn() }));
vi.mock("@/lib/notificationEmails", () => ({ sendPaymentOpsAlertEmail: (...a: unknown[]) => opsAlert(...a) }));

import {
  captureDepositClaim,
  DepositAlreadyResolvedError,
  DepositHoldExpiredError,
  releaseDeposit,
  transferDepositToHost,
} from "./depositSettlement";

type Row = Record<string, unknown> & { depositStatus: string };
let row: Row;

const db = {
  booking: {
    updateMany: async ({ where, data }: { where: { depositStatus: string }; data: object }) => {
      if (row.depositStatus !== where.depositStatus) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    update: async ({ data }: { data: object }) => Object.assign(row, data),
  },
} as unknown as Parameters<typeof releaseDeposit>[1];

const stripe = {
  paymentIntents: {
    cancel: vi.fn(),
    capture: vi.fn(),
    retrieve: vi.fn(async (): Promise<{ latest_charge?: string; status?: string }> => ({ latest_charge: "ch_deposit" })),
  },
  transfers: {
    create: vi.fn(async () => ({ id: "tr_1" })),
    // What Stripe already has in the booking's transfer group.
    list: vi.fn(async (): Promise<{ data: { id: string; created: number; metadata: Record<string, string> }[] }> => ({
      data: [],
    })),
  },
};
const s = stripe as unknown as Stripe;

const booking = {
  id: "bk_1",
  reference: "FY-DEP",
  stripeDepositPaymentIntentId: "pi_dep",
  hostConnectAccountId: "acct_host",
};

beforeEach(() => {
  row = { depositStatus: "AUTHORIZED" };
  vi.clearAllMocks();
  opsAlert.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("captureDepositClaim", () => {
  it("captures the claim and pays all of it to the host, once", async () => {
    await captureDepositClaim(s, db, booking, 12_000);

    expect(stripe.paymentIntents.capture).toHaveBeenCalledWith("pi_dep", { amount_to_capture: 12_000 });
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 12_000,
        currency: "gbp",
        destination: "acct_host",
        source_transaction: "ch_deposit",
      }),
      { idempotencyKey: "deposit-transfer:bk_1" },
    );
    expect(row).toMatchObject({ depositStatus: "CAPTURED", depositCapturedCents: 12_000, depositTransferId: "tr_1" });
  });

  it("lets only one of a claim and the cron's auto-release act on the hold", async () => {
    const results = await Promise.allSettled([
      captureDepositClaim(s, db, booking, 5_000),
      releaseDeposit(s, db, "bk_1", "pi_dep"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(
      DepositAlreadyResolvedError,
    );
    expect(stripe.paymentIntents.capture.mock.calls.length + stripe.paymentIntents.cancel.mock.calls.length).toBe(1);
  });

  it("puts the hold back if Stripe refuses the capture", async () => {
    stripe.paymentIntents.capture.mockRejectedValueOnce(new Error("authorization expired"));
    await expect(captureDepositClaim(s, db, booking, 5_000)).rejects.toThrow("authorization expired");
    expect(row).toMatchObject({ depositStatus: "AUTHORIZED", depositCapturedCents: null });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("keeps the capture and alerts when the transfer fails, for the cron to retry", async () => {
    stripe.transfers.create.mockRejectedValueOnce(new Error("account restricted"));
    await captureDepositClaim(s, db, booking, 5_000);
    expect(row).toMatchObject({ depositStatus: "CAPTURED" });
    expect(row.depositTransferId).toBeUndefined();
    expect(opsAlert).toHaveBeenCalledTimes(1);

    expect(
      await transferDepositToHost(s, db, { ...booking, depositCapturedCents: 5_000 }),
    ).toBe(true);
    expect(row.depositTransferId).toBe("tr_1");
  });
});

describe("transferDepositToHost", () => {
  it("doesn't move money for a host with no Stripe account, and alerts", async () => {
    expect(
      await transferDepositToHost(s, db, { ...booking, hostConnectAccountId: null, depositCapturedCents: 1_000 }),
    ).toBe(false);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(opsAlert).toHaveBeenCalledTimes(1);
  });

  it("records a transfer Stripe already made instead of paying the host twice once the idempotency key has expired", async () => {
    // A run days ago made the transfer but crashed before recording it.
    stripe.transfers.list.mockResolvedValueOnce({
      data: [
        { id: "tr_other", created: 1_790_000_000, metadata: { bookingId: "bk_1", purpose: "something_else" } },
        { id: "tr_earlier", created: 1_790_000_000, metadata: { bookingId: "bk_1", purpose: "deposit_claim" } },
      ],
    });
    row = { depositStatus: "CAPTURED" };
    expect(await transferDepositToHost(s, db, { ...booking, depositCapturedCents: 5_000 })).toBe(true);
    expect(stripe.transfers.list).toHaveBeenCalledWith({ transfer_group: "booking_bk_1", limit: 100 });
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(row).toMatchObject({ depositTransferId: "tr_earlier", depositTransferredAt: new Date(1_790_000_000 * 1000) });
  });
});

describe("releaseDeposit", () => {
  it("puts the hold back if Stripe refuses the release", async () => {
    stripe.paymentIntents.cancel.mockRejectedValueOnce(new Error("stripe down"));
    await expect(releaseDeposit(s, db, "bk_1", "pi_dep")).rejects.toThrow("stripe down");
    expect(row.depositStatus).toBe("AUTHORIZED");
  });

  it("records a hold the card network already released as released, so the cron stops retrying", async () => {
    stripe.paymentIntents.cancel.mockRejectedValueOnce(new Error("unexpected state"));
    stripe.paymentIntents.retrieve.mockResolvedValueOnce({ status: "canceled" });
    await releaseDeposit(s, db, "bk_1", "pi_dep");
    expect(row.depositStatus).toBe("RELEASED");
  });
});

describe("captureDepositClaim on a lapsed hold", () => {
  it("tells the host the hold expired and records it as released", async () => {
    stripe.paymentIntents.capture.mockRejectedValueOnce(new Error("unexpected state"));
    stripe.paymentIntents.retrieve.mockResolvedValueOnce({ status: "canceled" });
    await expect(captureDepositClaim(s, db, booking, 5_000)).rejects.toBeInstanceOf(DepositHoldExpiredError);
    expect(row.depositStatus).toBe("RELEASED");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
});
