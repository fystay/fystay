import type { PrismaClient } from "@prisma/client";

export type AccountDeletionBlock =
  | "upcoming_bookings_as_guest"
  | "listings_still_exist"
  | "stripe_connect_active";

/**
 * Real, structural reasons an account can't just be anonymized on the
 * spot - each one means real money or a real future stay is still in
 * flight, or a Stripe Connect payouts account needs a proper wind-down
 * this app doesn't attempt to automate. The account page shows these as
 * "resolve this first" rather than the delete button just failing
 * silently or, worse, deleting anyway and leaving dangling state.
 */
export async function findAccountDeletionBlocks(
  prisma: PrismaClient,
  userId: string,
): Promise<AccountDeletionBlock[]> {
  const [upcomingBookingsAsGuest, listingCount, user] = await Promise.all([
    prisma.booking.count({
      where: {
        guestId: userId,
        status: { in: ["PENDING", "CONFIRMED"] },
        checkOut: { gte: new Date() },
      },
    }),
    prisma.listing.count({ where: { hostId: userId } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { stripeConnectAccountId: true } }),
  ]);

  const blocks: AccountDeletionBlock[] = [];
  if (upcomingBookingsAsGuest > 0) blocks.push("upcoming_bookings_as_guest");
  if (listingCount > 0) blocks.push("listings_still_exist");
  if (user.stripeConnectAccountId) blocks.push("stripe_connect_active");
  return blocks;
}

/**
 * Anonymize-in-place (see the schema comment on User.deletedAt for why
 * this isn't a real row delete): scrubs every directly-identifying field,
 * clears passwordHash so credentials login can never succeed again, and
 * frees the original email up for reuse by randomizing it. Every Booking/
 * Review/Message/etc. this account ever created is untouched - those
 * belong to the historical record other parties (a host's own dashboard,
 * FYStay's own financial records) are entitled to keep.
 */
export async function anonymizeAccount(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.$transaction([
    // Releases any connected Google/Apple account, so signing in with it
    // later starts a fresh FYStay account instead of landing on this
    // deleted one (see resolveOAuthSignIn).
    prisma.authIdentity.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        name: "Deleted user",
        email: `deleted-${userId}@fystay.invalid`,
        passwordHash: null,
        phone: null,
        phoneVerifiedAt: null,
        image: null,
        twoFactorSecretCiphertext: null,
        twoFactorEnabledAt: null,
        twoFactorBackupCodeHashes: [],
        deletedAt: new Date(),
        // Kills every other still-live session this account had (a second
        // tab, another device) immediately, not just the one making this
        // request - see src/lib/sessionRevocation.ts. deletedAt alone
        // wouldn't do that: an already-issued JWT isn't re-checked against
        // it without this bump, only clearing passwordHash, which blocks a
        // *new* login, not an existing one.
        sessionVersion: { increment: 1 },
      },
    }),
  ]);
}
