import type Stripe from "stripe";
import type { Prisma, PrismaClient } from "@prisma/client";
import { isConnectReady } from "@/lib/stripeConnect";
import { reportError } from "@/lib/observability";

/**
 * When a host's share reaches their bank (owner's decision, 16 Oct: as late
 * as is allowed, to protect FYStay against cancellations and no-shows).
 *
 * The guest's payment is still a destination charge, so the host's share
 * lands in their Stripe balance when the guest pays, and a refund still
 * reverses it from there. What changes is the payout to the bank: host
 * accounts are on manual payouts, and the daily host-payouts cron pays out
 * only what no upcoming stay still needs. A booking's share is released the
 * day after check-out, or 89 days after the guest paid if that comes first:
 * Stripe requires manually held funds in the UK to be paid out within 90
 * days, so a booking made months ahead is paid out before its stay.
 */
export const RELEASE_DAYS_AFTER_CHECKOUT = 1;
export const MAX_HOLD_DAYS = 89;

const DAY_MS = 24 * 60 * 60 * 1000;

export function hostPayoutReleaseAt(booking: { checkOut: Date; paidAt: Date }): Date {
  const afterStay = booking.checkOut.getTime() + RELEASE_DAYS_AFTER_CHECKOUT * DAY_MS;
  const holdLimit = booking.paidAt.getTime() + MAX_HOLD_DAYS * DAY_MS;
  return new Date(Math.min(afterStay, holdLimit));
}

type HeldBooking = {
  checkOut: Date;
  paidAt: Date | null;
  totalPriceCents: number;
  applicationFeeCents: number | null;
  changeRequests: { applicationFeeCents: number | null }[];
};

/**
 * What a host's Stripe balance must keep for stays not yet released: each
 * booking's current total less FYStay's fees on it (the original charge's
 * and any paid date change's) - the share Stripe moved to the host.
 */
export function heldHostShareCents(bookings: HeldBooking[], now: Date): number {
  return bookings.reduce((sum, booking) => {
    if (!booking.paidAt || hostPayoutReleaseAt({ checkOut: booking.checkOut, paidAt: booking.paidAt }) <= now) return sum;
    const fees =
      (booking.applicationFeeCents ?? 0) +
      booking.changeRequests.reduce((total, change) => total + (change.applicationFeeCents ?? 0), 0);
    return sum + Math.max(0, booking.totalPriceCents - fees);
  }, 0);
}

/** Bookings whose host share may still be held (paid through Connect, not cancelled). */
export function heldBookingsWhere(hostId: string): Prisma.BookingWhereInput {
  return {
    listing: { hostId },
    hostPaidViaConnect: true,
    paidAt: { not: null },
    status: { in: ["CONFIRMED", "COMPLETED"] },
    paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED"] },
  };
}

export const MANUAL_PAYOUTS: Stripe.BalanceSettingsUpdateParams = {
  payments: { payouts: { schedule: { interval: "manual" } } },
};

/** Puts a host's account on manual payouts, if it isn't already. */
export async function ensureManualPayouts(stripe: Stripe, accountId: string): Promise<void> {
  const settings = await stripe.balanceSettings.retrieve({}, { stripeAccount: accountId });
  if (settings.payments?.payouts?.schedule?.interval === "manual") return;
  await stripe.balanceSettings.update(MANUAL_PAYOUTS, { stripeAccount: accountId });
}

export type HostPayoutResult = { accountId: string; paidOutCents: number; heldCents: number; error?: string };

/**
 * Pays out each host's released money: their available GBP balance less what
 * their unreleased stays still need. Refunds and reversals have already come
 * out of that balance, so it never pays out money a guest got back. One
 * host's failure never stops the others.
 */
export async function runHostPayouts(stripe: Stripe, db: PrismaClient, now = new Date()): Promise<HostPayoutResult[]> {
  const hosts = await db.user.findMany({
    where: { stripeConnectAccountId: { not: null } },
    select: { id: true, stripeConnectAccountId: true, stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true },
  });
  const results: HostPayoutResult[] = [];
  for (const host of hosts) {
    const accountId = host.stripeConnectAccountId!;
    if (!isConnectReady(host)) continue;
    try {
      await ensureManualPayouts(stripe, accountId);
      const bookings = await db.booking.findMany({
        where: heldBookingsWhere(host.id),
        select: {
          checkOut: true,
          paidAt: true,
          totalPriceCents: true,
          applicationFeeCents: true,
          changeRequests: { where: { paidAt: { not: null } }, select: { applicationFeeCents: true } },
        },
      });
      const heldCents = heldHostShareCents(bookings, now);
      const balance = await stripe.balance.retrieve({}, { stripeAccount: accountId });
      const availableCents = balance.available.find((entry) => entry.currency === "gbp")?.amount ?? 0;
      const amount = availableCents - heldCents;
      if (amount > 0) {
        await stripe.payouts.create(
          { amount, currency: "gbp", description: "FYStay payout", metadata: { fystay_user_id: host.id } },
          { stripeAccount: accountId, idempotencyKey: `host-payout:${accountId}:${now.toISOString().slice(0, 10)}:${amount}` },
        );
      }
      results.push({ accountId, paidOutCents: Math.max(0, amount), heldCents });
    } catch (error) {
      reportError(error, { area: "payments", message: `Host payout failed for ${accountId}` });
      results.push({ accountId, paidOutCents: 0, heldCents: 0, error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return results;
}
