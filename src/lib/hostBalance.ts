import { getStripeClient } from "@/lib/stripe";

export type HostStripeBalance = { availableCents: number; pendingCents: number };

/**
 * What's in the host's own Stripe account right now, read live from Stripe
 * (FYStay keeps no copy, so it can never disagree with what Stripe shows
 * them). With destination charges, a booking's share lands there when the
 * guest pays: "pending" until the card payment settles, then "available"
 * until Stripe pays it out to the host's bank on their payout schedule.
 *
 * Null when Stripe isn't configured, the host has no account yet, or
 * Stripe can't be reached - the earnings page then says so rather than
 * showing £0.
 */
export async function getHostStripeBalance(connectAccountId: string | null): Promise<HostStripeBalance | null> {
  const stripe = getStripeClient();
  if (!stripe || !connectAccountId) return null;
  try {
    const balance = await stripe.balance.retrieve({}, { stripeAccount: connectAccountId });
    const gbp = (entries: { amount: number; currency: string }[]) =>
      entries.filter((e) => e.currency === "gbp").reduce((sum, e) => sum + e.amount, 0);
    return { availableCents: gbp(balance.available), pendingCents: gbp(balance.pending) };
  } catch (error) {
    console.error("couldn't read a host's Stripe balance", { error: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}
