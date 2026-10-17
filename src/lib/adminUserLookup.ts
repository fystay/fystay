import { prisma } from "@/lib/prisma";

/** Same reasoning as adminBookingLookup.ts - shared between /api/admin/users* and /admin/users*. */
export const MIN_QUERY_LENGTH = 2;
export const SEARCH_RESULT_LIMIT = 25;

export async function searchUsersForAdmin(q: string) {
  const query = q.trim();
  if (query.length < MIN_QUERY_LENGTH) return null;

  return prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: SEARCH_RESULT_LIMIT,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      deletedAt: true,
      _count: { select: { bookings: true, listings: true } },
    },
  });
}

export type AdminUserSearchRow = NonNullable<Awaited<ReturnType<typeof searchUsersForAdmin>>>[number];

export async function getUserDetailForAdmin(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      deletedAt: true,
      suspendedAt: true,
      suspendedReason: true,
      phone: true,
      phoneVerifiedAt: true,
      identityVerificationStatus: true,
      identityVerifiedAt: true,
      twoFactorEnabledAt: true,
      stripeConnectAccountId: true,
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
      referralCode: true,
      creditBalanceCents: true,
      referralBonusAwarded: true,
      referredBy: { select: { id: true, name: true, email: true } },
      _count: { select: { referrals: true, bookings: true, listings: true } },
      bookings: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          reference: true,
          status: true,
          paymentStatus: true,
          checkIn: true,
          totalPriceCents: true,
          createdAt: true,
          listing: { select: { title: true } },
        },
      },
      listings: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          title: true,
          published: true,
          city: true,
          propertyType: true,
        },
      },
    },
  });
}

export type AdminUserDetail = NonNullable<Awaited<ReturnType<typeof getUserDetailForAdmin>>>;
