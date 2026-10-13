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
 *
 * FYStay's live Stripe platform won't grant stripe_transfers on its own
 * (capability_not_available_without_other_capability), so card_payments is
 * requested alongside it - the classic Express marketplace setup. Guests
 * still pay FYStay through destination charges; hosts never take card
 * payments themselves, and readiness still follows stripe_transfers.
 */
export function hostConnectAccountParams(host: {
  userId: string;
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
      merchant: { capabilities: { card_payments: { requested: true } } },
    },
    // Lets anyone looking at the account in Stripe find the FYStay user.
    metadata: { fystay_user_id: host.userId },
    include: ["configuration.recipient", "configuration.merchant"],
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
 * What Stripe still needs before a host can be paid, from the account's
 * requirements - only what the host needs to know, never the values they
 * gave Stripe. `due` lists Stripe's own plain descriptions of what the
 * host must still provide; `reviewing` means everything is in and Stripe
 * is checking it; `rejected` means Stripe couldn't verify something the
 * host gave and it has to be corrected.
 */
export type ConnectRequirements = {
  due: string[];
  overdue: boolean;
  reviewing: boolean;
  rejected: boolean;
};

export function connectRequirementsFromV2Account(account: Stripe.V2.Core.Account): ConnectRequirements {
  const entries = account.requirements?.entries ?? [];
  const fromHost = entries.filter((entry) => entry.awaiting_action_from === "user");
  return {
    due: [...new Set(fromHost.map((entry) => entry.description).filter(Boolean))],
    overdue: fromHost.some((entry) => entry.minimum_deadline?.status === "past_due"),
    reviewing: entries.some((entry) => entry.awaiting_action_from === "stripe"),
    rejected: fromHost.some((entry) => entry.errors.length > 0),
  };
}

/**
 * Re-reads a connected account's status directly from Stripe, persists the
 * three flags and returns them with what Stripe still needs. Readiness only
 * ever comes from here (or the account.updated webhook, which calls it) -
 * never from a host having clicked through or come back from Stripe.
 */
export async function loadConnectAccountStatus(accountId: string) {
  const stripe = getStripeClient();
  if (!stripe) return null;
  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ["configuration.recipient", "requirements"],
  });
  const flags = connectFlagsFromV2Account(account);
  await prisma.user.update({ where: { stripeConnectAccountId: accountId }, data: flags });
  return { flags, requirements: connectRequirementsFromV2Account(account) };
}

/**
 * The persisted flags alone, for the webhook and the pre-payment check.
 */
export async function refreshConnectAccountStatus(accountId: string) {
  return (await loadConnectAccountStatus(accountId))?.flags ?? null;
}

export { HOST_NOT_PAYMENT_READY_MESSAGE } from "@/lib/paymentMessages";

/**
 * A destination charge's payment_intent_data: the whole payment goes to the
 * host's connected account and FYStay's application fee comes back from it.
 * A promo or referral credit can use up the whole commission, and 10% of a
 * very small date-change difference can round to nothing - then there's no
 * fee to take and the host keeps the full charge (still exactly their share),
 * so only a positive fee is sent.
 */
export function destinationChargeData(
  destinationAccountId: string,
  applicationFeeCents: number,
): Pick<Stripe.PaymentIntentCreateParams, "application_fee_amount" | "transfer_data"> {
  return {
    ...(applicationFeeCents > 0 && { application_fee_amount: applicationFeeCents }),
    transfer_data: { destination: destinationAccountId },
  };
}

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
  return payoutReadinessRequired()
    ? { host: { stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true } }
    : {};
}

/**
 * Whether a host must be payout-ready before their listing is shown or
 * published - the condition behind bookableHostWhere() and
 * hostAcceptsPaidBookings(), for the publication checks in
 * src/lib/listingReview.ts.
 */
export function payoutReadinessRequired(): boolean {
  return Boolean(getStripeClient());
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
