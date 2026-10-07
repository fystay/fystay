import type Stripe from "stripe";
import type { PrismaClient } from "@prisma/client";
import { stripeDashboardPaymentUrl } from "@/lib/stripe";
import { sendPaymentOpsAlertEmail } from "@/lib/notificationEmails";

type Db = Pick<PrismaClient, "booking">;

export class DepositAlreadyResolvedError extends Error {
  constructor() {
    super("This deposit has already been released or claimed");
    this.name = "DepositAlreadyResolvedError";
  }
}

/**
 * Releases an AUTHORIZED hold - by the host, or by the cron once the claim
 * window closes. The status is claimed in the database first, so a host
 * claim and the cron's auto-release racing each other can't both act on
 * the same hold; if Stripe then refuses, the hold is put back as it was.
 */
export async function releaseDeposit(stripe: Stripe, db: Db, bookingId: string, paymentIntentId: string) {
  const claimed = await db.booking.updateMany({
    where: { id: bookingId, depositStatus: "AUTHORIZED" },
    data: { depositStatus: "RELEASED", depositReleasedAt: new Date() },
  });
  if (claimed.count === 0) throw new DepositAlreadyResolvedError();
  try {
    await stripe.paymentIntents.cancel(paymentIntentId);
  } catch (error) {
    await db.booking.update({
      where: { id: bookingId },
      data: { depositStatus: "AUTHORIZED", depositReleasedAt: null },
    });
    throw error;
  }
}

/**
 * Captures a host's claim and passes the money on to them. Same claim-first
 * rule as releaseDeposit. Returns once the capture has succeeded; a failed
 * transfer to the host doesn't undo the capture (the guest has been
 * charged, correctly) - it's alerted and retried by the daily cron.
 */
export async function captureDepositClaim(
  stripe: Stripe,
  db: Db,
  booking: { id: string; reference: string; stripeDepositPaymentIntentId: string; hostConnectAccountId: string | null },
  amountCents: number,
) {
  const claimed = await db.booking.updateMany({
    where: { id: booking.id, depositStatus: "AUTHORIZED" },
    data: { depositStatus: "CAPTURED", depositCapturedCents: amountCents, depositCapturedAt: new Date() },
  });
  if (claimed.count === 0) throw new DepositAlreadyResolvedError();

  try {
    await stripe.paymentIntents.capture(booking.stripeDepositPaymentIntentId, { amount_to_capture: amountCents });
  } catch (error) {
    await db.booking.update({
      where: { id: booking.id },
      data: { depositStatus: "AUTHORIZED", depositCapturedCents: null, depositCapturedAt: null },
    });
    throw error;
  }

  await transferDepositToHost(stripe, db, {
    id: booking.id,
    reference: booking.reference,
    stripeDepositPaymentIntentId: booking.stripeDepositPaymentIntentId,
    hostConnectAccountId: booking.hostConnectAccountId,
    depositCapturedCents: amountCents,
  });
}

/**
 * The deposit hold is charged to FYStay's own Stripe account (it has no
 * transfer_data - it's placed days before check-in, separately from the
 * booking payment), so a claim reaches the host only through this
 * transfer. The full claim goes to the host: FYStay takes no cut of
 * damage money and absorbs Stripe's processing fee, as on bookings.
 *
 * Safe to call repeatedly (the cron retries any captured claim not yet
 * transferred): an existing deposit-claim transfer for the booking is
 * found and recorded rather than repeated, the Stripe idempotency key is
 * fixed per booking, and source_transaction ties the transfer to the guest's actual charge, so
 * the money moves once and only after the charge's funds exist.
 *
 * Returns true once the transfer is recorded. Never throws - a failure is
 * logged and alerted, and left for the next cron run.
 */
export async function transferDepositToHost(
  stripe: Stripe,
  db: Db,
  booking: {
    id: string;
    reference: string;
    stripeDepositPaymentIntentId: string;
    hostConnectAccountId: string | null;
    depositCapturedCents: number;
  },
): Promise<boolean> {
  if (booking.depositCapturedCents <= 0) return true;

  const alert = (summary: string) =>
    sendPaymentOpsAlertEmail({
      subject: "A deposit claim hasn't reached the host",
      summary,
      amountCents: booking.depositCapturedCents,
      bookingReference: booking.reference,
      action:
        "Check the host's Stripe account. FYStay retries every day; if it keeps failing, pay the host this amount from the Stripe Dashboard.",
      stripeUrl: stripeDashboardPaymentUrl(booking.stripeDepositPaymentIntentId),
    }).catch((error) => console.error("deposit transfer alert failed", error));

  if (!booking.hostConnectAccountId) {
    console.error(`deposit transfer skipped for booking ${booking.id}: host has no Stripe account`);
    await alert("The host has no connected Stripe account, so their deposit claim couldn't be paid to them.");
    return false;
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(booking.stripeDepositPaymentIntentId);
    const chargeId =
      typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id;
    if (!chargeId) throw new Error("captured deposit has no charge");

    // Stripe forgets an idempotency key after about 24 hours, and the cron
    // retries daily - so a transfer that went through but whose id never
    // got recorded here (a crash, a failed write) would be made a second
    // time by the next run. Stripe's own record of the booking's transfers
    // is checked first, and an existing deposit-claim transfer is recorded
    // instead of making another.
    const existing = await stripe.transfers.list({ transfer_group: `booking_${booking.id}`, limit: 100 });
    const alreadyMade = existing.data.find(
      (transfer) => transfer.metadata?.purpose === "deposit_claim" && transfer.metadata?.bookingId === booking.id,
    );
    if (alreadyMade) {
      await db.booking.update({
        where: { id: booking.id },
        data: { depositTransferId: alreadyMade.id, depositTransferredAt: new Date(alreadyMade.created * 1000) },
      });
      return true;
    }

    const transfer = await stripe.transfers.create(
      {
        amount: booking.depositCapturedCents,
        currency: "gbp",
        destination: booking.hostConnectAccountId,
        source_transaction: chargeId,
        transfer_group: `booking_${booking.id}`,
        description: `Security deposit claim, booking ${booking.reference}`,
        metadata: { bookingId: booking.id, purpose: "deposit_claim" },
      },
      { idempotencyKey: `deposit-transfer:${booking.id}` },
    );

    await db.booking.update({
      where: { id: booking.id },
      data: { depositTransferId: transfer.id, depositTransferredAt: new Date() },
    });
    return true;
  } catch (error) {
    console.error(`deposit transfer failed for booking ${booking.id}:`, error);
    await alert("Stripe refused the transfer of a deposit claim to the host.");
    return false;
  }
}
