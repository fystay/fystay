import { randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

// Excludes visually ambiguous characters (0/O, 1/I), same alphabet as
// bookingReference.ts - this code gets read off a screen and typed into a
// signup form by someone else, so it needs the same care.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/** A short, shareable referral code, e.g. "7K3PQ9". */
export function generateReferralCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

// Both the new signup's immediate welcome credit and the referrer's later
// bonus use the same amount - simple to explain ("you both get £10"),
// which matters more here than either side getting a cleverer amount.
export const REFERRAL_CREDIT_CENTS = 1000;

/**
 * How much of a guest's credit balance a booking can actually spend: never
 * more than they have, and never more than the booking costs (no
 * overspend into a negative total, and no cash-back for an unused
 * remainder - the excess simply stays in their balance for next time).
 */
export function computeCreditToApply(creditBalanceCents: number, totalBeforeCreditCents: number): number {
  return Math.max(0, Math.min(creditBalanceCents, totalBeforeCreditCents));
}

/**
 * Awards the referrer's bonus the moment their referral's booking is
 * confirmed and paid - not at signup, so a throwaway account can't farm
 * credit without a real transaction behind it. Guarded by
 * referralBonusAwarded on the REFEREE's own row (not a count of their
 * bookings) so this is safe to call after every booking they ever
 * complete: the first call that finds them eligible pays the referrer
 * once, and every call after that is a no-op. Called from both the
 * Stripe webhook and the "Stripe isn't configured" dev-mode confirm path
 * in /api/checkout, since either can be the one that first confirms a
 * guest's booking.
 */
export async function awardReferralBonusIfEligible(prisma: PrismaClient, guestId: string): Promise<void> {
  const guest = await prisma.user.findUnique({
    where: { id: guestId },
    select: { referredByUserId: true, referralBonusAwarded: true, emailVerifiedAt: true },
  });
  // A referral only counts from a proven email address: otherwise one
  // person could refer themselves from made-up addresses. Checked again
  // after each later booking, so verifying later still earns it.
  if (!guest?.referredByUserId || guest.referralBonusAwarded || !guest.emailVerifiedAt) return;

  // Guarded by the WHERE clause, not a separate read-then-write: two
  // confirmations racing for the same guest (webhook + dev-mode, or a
  // redelivered webhook) can both reach this line, but only the first
  // update actually matches referralBonusAwarded: false and flips it, so
  // only one of them goes on to credit the referrer below.
  const { count } = await prisma.user.updateMany({
    where: { id: guestId, referralBonusAwarded: false },
    data: { referralBonusAwarded: true },
  });
  if (count === 0) return;

  await prisma.user.update({
    where: { id: guest.referredByUserId },
    data: { creditBalanceCents: { increment: REFERRAL_CREDIT_CENTS } },
  });
}
