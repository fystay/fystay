import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { PrismaClient } from "@prisma/client";
import { recordStripeProcessingFee } from "./processingFees";

const stripeReturning = (latestCharge: unknown) =>
  ({ paymentIntents: { retrieve: vi.fn(async () => ({ latest_charge: latestCharge })) } }) as unknown as Stripe;
const db = () => {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  return { db: { booking: { updateMany } } as unknown as PrismaClient, updateMany };
};

describe("recordStripeProcessingFee", () => {
  it("stores Stripe's actual GBP fee once", async () => {
    const { db: prisma, updateMany } = db();
    await recordStripeProcessingFee(stripeReturning({ balance_transaction: { fee: 815, currency: "gbp" } }), prisma, "bk_1", "pi_1");
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "bk_1", stripeProcessingFeeCents: null }, data: { stripeProcessingFeeCents: 815 } });
  });

  it("is safe on a webhook retry: only a booking with no fee recorded yet is written", async () => {
    const { db: prisma, updateMany } = db();
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const stripe = stripeReturning({ balance_transaction: { fee: 815, currency: "gbp" } });
    await recordStripeProcessingFee(stripe, prisma, "bk_1", "pi_1");
    await recordStripeProcessingFee(stripe, prisma, "bk_1", "pi_1");
    for (const [args] of updateMany.mock.calls as unknown as [{ where: object }][]) {
      expect(args.where).toEqual({ id: "bk_1", stripeProcessingFeeCents: null });
    }
  });

  it("stores nothing it can't trust: another currency, an unexpanded transaction, or no payment", async () => {
    const { db: prisma, updateMany } = db();
    await recordStripeProcessingFee(stripeReturning({ balance_transaction: { fee: 815, currency: "eur" } }), prisma, "bk_1", "pi_1");
    await recordStripeProcessingFee(stripeReturning({ balance_transaction: "txn_1" }), prisma, "bk_1", "pi_1");
    await recordStripeProcessingFee(stripeReturning(null), prisma, "bk_1", null);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("never throws: the booking is already confirmed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = { paymentIntents: { retrieve: vi.fn(async () => { throw new Error("stripe down"); }) } } as unknown as Stripe;
    await expect(recordStripeProcessingFee(failing, db().db, "bk_1", "pi_1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("stripe_fee_lookup_failed", expect.objectContaining({ bookingId: "bk_1" }));
    warn.mockRestore();
  });
});
