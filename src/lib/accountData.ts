import type { PrismaClient } from "@prisma/client";

/**
 * Everything a self-service "export my data" request returns - the
 * Privacy Policy already promises guests and hosts can get a copy of their
 * own data; this is what actually builds it. Scoped to what this account
 * itself created or is the direct subject of, never another user's private
 * details beyond what that account already sees elsewhere in the product
 * (e.g. a host already sees a guest's name/email on their own bookings
 * dashboard - exporting the same fields here isn't a new disclosure).
 * Excludes anything purely internal/security-sensitive: password hashes,
 * Stripe/PMS session or payment-intent ids, encrypted credential
 * ciphertext, rate-limit rows.
 */
export async function buildAccountDataExport(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      phoneVerifiedAt: true,
      role: true,
      identityVerificationStatus: true,
      referralCode: true,
      creditBalanceCents: true,
      createdAt: true,
      // Which Google/Apple accounts can sign in to this one, and the email
      // each reported - the provider's own id isn't the person's data.
      authIdentities: { select: { provider: true, email: true, createdAt: true } },
    },
  });

  const bookingsAsGuest = await prisma.booking.findMany({
    where: { guestId: userId },
    select: {
      reference: true,
      status: true,
      paymentStatus: true,
      checkIn: true,
      checkOut: true,
      guests: true,
      totalPriceCents: true,
      createdAt: true,
      listing: { select: { title: true, city: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const reviewsAuthored = await prisma.review.findMany({
    where: { authorId: userId },
    select: {
      rating: true,
      comment: true,
      createdAt: true,
      listing: { select: { title: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const messagesSent = await prisma.message.findMany({
    where: { senderId: userId },
    select: {
      body: true,
      createdAt: true,
      conversation: { select: { listing: { select: { title: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const listingsAsHost =
    user.role === "HOST"
      ? await prisma.listing.findMany({
          where: { hostId: userId },
          select: {
            title: true,
            city: true,
            propertyType: true,
            published: true,
            createdAt: true,
            bookings: {
              select: {
                reference: true,
                status: true,
                paymentStatus: true,
                checkIn: true,
                checkOut: true,
                totalPriceCents: true,
                guestName: true,
                guestEmail: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
            },
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

  const pmsConnections =
    user.role === "HOST"
      ? await prisma.pmsConnection.findMany({
          where: { hostId: userId },
          select: { provider: true, status: true, externalPropertyName: true, connectedAt: true },
        })
      : [];

  return {
    exportedAt: new Date().toISOString(),
    profile: user,
    bookingsAsGuest,
    reviewsAuthored,
    messagesSent,
    listingsAsHost,
    pmsConnections,
  };
}
