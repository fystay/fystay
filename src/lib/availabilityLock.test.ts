import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { lockListingAvailability, withListingAvailabilityLock } from "./availabilityLock";

function fakePrisma() {
  const executeRaw = vi.fn(async () => 0);
  const tx = { $executeRaw: executeRaw };
  // The options (isolation level) are read back from mock.calls.
  const transaction = vi.fn(async (...args: [fn: (t: typeof tx) => unknown, options?: unknown]) => args[0](tx));
  return { prisma: { $transaction: transaction } as unknown as PrismaClient, tx, executeRaw, transaction };
}

describe("lockListingAvailability", () => {
  it("takes a transaction-scoped advisory lock keyed by the listing", async () => {
    const { tx, executeRaw } = fakePrisma();
    await lockListingAvailability(tx as unknown as Prisma.TransactionClient, "listing_1");
    const [strings, key] = executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, string];
    expect(strings.join("?")).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(key).toBe("listing:listing_1");
  });
});

describe("withListingAvailabilityLock", () => {
  it("locks before running the callback, in a READ COMMITTED transaction", async () => {
    const { prisma, executeRaw, transaction } = fakePrisma();
    const order: string[] = [];
    executeRaw.mockImplementation(async () => {
      order.push("lock");
      return 0;
    });
    const result = await withListingAvailabilityLock(prisma, "listing_1", async () => {
      order.push("work");
      return "done";
    });
    expect(result).toBe("done");
    expect(order).toEqual(["lock", "work"]);
    // A SERIALIZABLE/REPEATABLE READ snapshot would be taken before the
    // lock wait and read a stale calendar after it.
    expect(transaction.mock.calls[0][1]).toMatchObject({
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  });
});
