import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Every write that can make a listing's dates unavailable - creating a
 * booking, confirming a paid one, approving a request or a date change,
 * adding a host block - reads the calendar, decides, then writes. Two of
 * those running at once can each read a calendar the other hasn't written to
 * yet, and both go ahead: a double booking. Postgres has no constraint that
 * can say "no overlapping date ranges, counted per room type", so instead
 * every such writer takes this per-listing lock first and re-checks
 * availability inside the same transaction, after it holds the lock. Writers
 * for one listing then run one at a time; different listings never wait on
 * each other.
 *
 * Keyed by listing even for a hotel's room types, so a listing-wide block
 * (an iCal import, roomTypeId null) and a room-type booking can't race each
 * other either.
 *
 * pg_advisory_xact_lock is released automatically when the transaction
 * commits or rolls back, so there's nothing to unlock and no way to leak it.
 */
export async function lockListingAvailability(tx: Prisma.TransactionClient, listingId: string): Promise<void> {
  // $executeRaw, not $queryRaw: the function returns void, which Prisma
  // can't deserialize as a result column.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`listing:${listingId}`}::text, 0))`;
}

/**
 * Runs fn in a transaction that holds the listing's availability lock.
 *
 * Deliberately READ COMMITTED, never SERIALIZABLE or REPEATABLE READ: those
 * take their snapshot at the transaction's first statement - the lock call
 * itself, before it has waited - so after the wait they'd still read the
 * calendar as it was before the writer they were waiting on committed, and
 * the lock would protect nothing. Under READ COMMITTED each read after the
 * lock sees everything committed up to that moment.
 */
export async function withListingAvailabilityLock<T>(
  prisma: PrismaClient,
  listingId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await lockListingAvailability(tx, listingId);
      return fn(tx);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      // Time spent queued behind another writer for the same listing counts
      // against the transaction's timeout, so allow more than Prisma's 5s.
      timeout: 15_000,
    },
  );
}
