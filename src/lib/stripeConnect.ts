import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";

/**
 * Hosts are Connect *recipient* accounts on Stripe's Accounts v2 API: FYStay
 * runs checkout and is merchant of record, and each booking's payout reaches
 * the host as a destination charge (see /api/checkout). The settings below
 * are Stripe's marketplace defaults - an Express dashboard for the host, and
 * FYStay owning pricing (fees) and negative-balance liability (losses),
 * which destination charges require.
 */
export function hostConnectAccountParams(host: {
  email: string;
  name: string | null;
}): Stripe.V2.Core.AccountCreateParams {
  return {
    contact_email: host.email,
    ...(host.name ? { display_name: host.name } : {}),
    dashboard: "express",
    identity: { country: "gb" },
    defaults: {
      currency: "gbp",
      responsibilities: { fees_collector: "application", losses_collector: "application" },
    },
    configuration: {
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
    },
    include: ["configuration.recipient"],
  };
}

/**
 * A host is only actually payable once Stripe reports both flags true.
 * Kept as a single predicate so every call site (checkout, the dashboard
 * banner, the change-request payment) agrees on what "ready" means. With
 * Accounts v2 both flags track the recipient's stripe_transfers capability
 * (see connectFlagsFromV2Account) - the columns keep their original names
 * so nothing that reads them has to change.
 */
export function isConnectReady(host: {
  stripeConnectChargesEnabled: boolean;
  stripeConnectPayoutsEnabled: boolean;
}): boolean {
  return host.stripeConnectChargesEnabled && host.stripeConnectPayoutsEnabled;
}

/**
 * Maps a v2 Account onto the three flags this app persists, from the
 * recipient's stripe_transfers capability - Stripe's go-live check for a
 * marketplace recipient (never the deprecated v1 charges_enabled /
 * payouts_enabled, which stay false for a recipient-only account).
 */
export function connectFlagsFromV2Account(account: Stripe.V2.Core.Account) {
  const balance = account.configuration?.recipient?.capabilities?.stripe_balance;
  const transfers = balance?.stripe_transfers;
  const transfersActive = transfers?.status === "active";
  // Payouts to the host's bank, when Stripe reports that capability;
  // otherwise transfers being active is the readiness signal on its own.
  const payoutsStatus = balance?.payouts?.status;
  const detailsSubmitted =
    transfersActive ||
    (transfers?.status_details ?? []).some(
      (detail) => detail.code === "requirements_pending_verification",
    );
  return {
    stripeConnectDetailsSubmitted: detailsSubmitted,
    stripeConnectChargesEnabled: transfersActive,
    stripeConnectPayoutsEnabled: transfersActive && (payoutsStatus === undefined || payoutsStatus === "active"),
  };
}

/**
 * Re-reads a connected account's status directly from Stripe and persists
 * it. Called on a host's return from onboarding (/host/payouts) - so they
 * don't wait on a webhook that may not even be configured in local
 * development - and from the account.updated webhook.
 */
export async function refreshConnectAccountStatus(accountId: string) {
  const stripe = getStripeClient();
  if (!stripe) return null;
  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ["configuration.recipient"],
  });
  const flags = connectFlagsFromV2Account(account);
  await prisma.user.update({ where: { stripeConnectAccountId: accountId }, data: flags });
  return flags;
}

export { HOST_NOT_PAYMENT_READY_MESSAGE } from "@/lib/paymentMessages";

/**
 * Whether a host can take a *paid* booking right now: only once their
 * Connect account can receive their share automatically, so a guest's
 * payment never sits in FYStay's balance waiting to be paid out by hand.
 * With no Stripe key configured (local development, CI) bookings confirm
 * without a real payment and there's nothing to route, so this doesn't
 * apply - a production deployment refuses payment without a key anyway
 * (see allowsUnpaidConfirmation).
 */
export function hostAcceptsPaidBookings(host: {
  stripeConnectChargesEnabled: boolean;
  stripeConnectPayoutsEnabled: boolean;
}): boolean {
  return !getStripeClient() || isConnectReady(host);
}

/**
 * The same rule as a listing filter, for everywhere guests browse (search,
 * the homepage rows, suggestions, the sitemap): a listing whose host can't
 * be paid yet isn't shown at all, so no guest finds a stay only to be told
 * it can't be booked. The host still sees it in their dashboard and can
 * open its page. With no Stripe key configured nothing is filtered, the
 * same as hostAcceptsPaidBookings.
 */
export function bookableHostWhere(): Prisma.ListingWhereInput {
  return getStripeClient()
    ? { host: { stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true } }
    : {};
}

/**
 * The same check, re-read live from Stripe right before taking a payment
 * (Stripe's go-live guidance: re-check capability status before every
 * payment, since an account can become restricted at any time). Fails
 * closed - an error reading the account means no payment.
 */
export async function verifyHostPaymentReady(host: {
  stripeConnectAccountId: string | null;
  stripeConnectChargesEnabled: boolean;
  stripeConnectPayoutsEnabled: boolean;
}): Promise<boolean> {
  if (!getStripeClient()) return true;
  if (!host.stripeConnectAccountId) return false;
  try {
    const flags = await refreshConnectAccountStatus(host.stripeConnectAccountId);
    return flags ? isConnectReady(flags) : false;
  } catch (error) {
    console.error("Couldn't verify host Connect status before payment", { error });
    return false;
  }
}
