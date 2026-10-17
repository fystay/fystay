import Stripe from "stripe";
import { isProductionDeployment, type EnvSource } from "@/lib/deploymentEnvironment";
import { hasTraderIdentity } from "@/lib/companyInfo";

/**
 * Whether a Stripe secret key belongs on this deployment: live keys
 * (sk_live_/rk_live_) only on Production, and never on Preview, local or CI.
 * A key in the wrong place is treated as no key at all - on Production that
 * means payments are refused, never taken with test money; elsewhere it
 * means no real card can ever be charged from a test environment.
 */
export function stripeKeyMatchesEnvironment(key: string, env: EnvSource = process.env): boolean {
  const live = /^(sk|rk)_live_/.test(key);
  return isProductionDeployment(env) ? live : !live;
}

export function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeKeyMatchesEnvironment(key)) {
    console.error(
      isProductionDeployment()
        ? "STRIPE_SECRET_KEY on Production is not a live key - payments are refused until a live key is set."
        : "STRIPE_SECRET_KEY outside Production is a live key - ignored, so no real card can be charged here.",
    );
    return null;
  }
  return new Stripe(key);
}

/**
 * The Stripe client for starting a new payment (a booking, a date change,
 * an extra, a Spotlight purchase). On Production it's also withheld until
 * the trader's legal name and address are set: UK law requires a trader to
 * identify themselves to the customer before taking payment, so a live
 * charge without them is refused like any other unavailable payment - the
 * caller's existing "no Stripe" branch answers 503. Refunds, cancellations,
 * webhooks and payouts keep using getStripeClient(), so existing bookings
 * can always be managed.
 */
export function getStripeClientForNewCharge(): Stripe | null {
  if (isProductionDeployment() && !hasTraderIdentity()) {
    console.error(
      "NEXT_PUBLIC_COMPANY_LEGAL_NAME and NEXT_PUBLIC_COMPANY_ADDRESS (and, for a limited company, NEXT_PUBLIC_COMPANY_NUMBER and NEXT_PUBLIC_COMPANY_REGISTERED_IN) must be set on Production - new payments are refused until they are.",
    );
    return null;
  }
  return getStripeClient();
}

/**
 * Whether a payment route may confirm without charging when Stripe isn't
 * configured - the dev-mode fallback that keeps local, CI and preview
 * bookings exercisable with no keys. Never on a production deployment:
 * there, a missing STRIPE_SECRET_KEY means payments aren't available, not
 * that a booking is free.
 */
export function allowsUnpaidConfirmation(env: EnvSource = process.env): boolean {
  return !isProductionDeployment(env);
}

export const PAYMENTS_UNAVAILABLE_MESSAGE =
  "Online payment isn't available yet, so this booking can't be confirmed. Your dates are still held - please try again later.";

/**
 * A link straight to a payment in the Stripe Dashboard, for admin pages -
 * test-mode payments live under /test. Only says which mode the key is in,
 * never anything about the key itself.
 */
export function stripeDashboardPaymentUrl(paymentIntentId: string, env: EnvSource = process.env): string {
  const testMode = !/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? "");
  return `https://dashboard.stripe.com/${testMode ? "test/" : ""}payments/${encodeURIComponent(paymentIntentId)}`;
}
