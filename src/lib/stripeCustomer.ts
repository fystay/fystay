import { createHash } from "crypto";
import type Stripe from "stripe";
import type { PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "user">;

/**
 * The Stripe Customer for a FYStay user - created the first time they pay
 * for anything, then reused, so all of one person's payments sit under one
 * customer in Stripe (receipts, refunds and disputes in one place).
 *
 * Only ever called with the id of the signed-in user making the payment
 * (every caller has already checked the booking/listing is theirs), so one
 * person can never be attached to another's customer.
 *
 * - No duplicates: creation carries an idempotency key tied to the user,
 *   so two checkouts started at the same moment get the same customer back
 *   from Stripe; the id is then stored only if none was stored meanwhile.
 * - Self-healing: a stored customer that no longer exists in Stripe (deleted
 *   in the Dashboard, or a different Stripe account's id) is replaced.
 * - Email kept current, so Stripe receipts follow an email change.
 */
export async function getOrCreateStripeCustomer(stripe: Stripe, db: Db, userId: string): Promise<string> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true, stripeCustomerId: true },
  });

  if (user.stripeCustomerId) {
    const existing = await retrieveLiveCustomer(stripe, user.stripeCustomerId);
    if (existing) {
      if (existing.email !== user.email) {
        await stripe.customers.update(existing.id, { email: user.email });
      }
      return existing.id;
    }
  }

  const customer = await stripe.customers.create(
    { email: user.email, name: user.name, metadata: { fystayUserId: user.id } },
    // Same person, same details -> same key, so racing requests share one
    // customer. The replaced id (if any) is in it so replacing a stale
    // customer isn't answered with that stale one from Stripe's idempotency
    // cache, and a hash of the details so a name/email edit in between
    // doesn't collide with an earlier attempt's parameters.
    {
      idempotencyKey: `fystay-customer:${user.id}:${user.stripeCustomerId ?? "new"}:${createHash("sha256")
        .update(`${user.email}\n${user.name}`)
        .digest("hex")
        .slice(0, 16)}`,
    },
  );

  const stored = await db.user.updateMany({
    where: { id: user.id, stripeCustomerId: user.stripeCustomerId },
    data: { stripeCustomerId: customer.id },
  });
  if (stored.count === 0) {
    // Another request stored one first - use theirs.
    const winner = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { stripeCustomerId: true } });
    if (winner.stripeCustomerId) return winner.stripeCustomerId;
  }
  return customer.id;
}

async function retrieveLiveCustomer(stripe: Stripe, customerId: string): Promise<Stripe.Customer | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer.deleted ? null : customer;
  } catch (error) {
    if ((error as { code?: string }).code === "resource_missing") return null;
    throw error;
  }
}

/**
 * Account deletion: removes the person's details from Stripe as well as
 * from FYStay. Past payments, refunds and disputes stay in Stripe (they're
 * financial records); only the customer profile goes. Best-effort - the
 * FYStay account is already anonymised, so a Stripe hiccup is logged, not
 * thrown.
 */
export async function deleteStripeCustomer(stripe: Stripe, customerId: string): Promise<void> {
  try {
    await stripe.customers.del(customerId);
  } catch (error) {
    if ((error as { code?: string }).code === "resource_missing") return;
    console.error("Couldn't delete the Stripe customer for a deleted account", {
      customerId,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
