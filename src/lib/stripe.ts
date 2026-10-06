import Stripe from "stripe";
import { isProductionDeployment, type EnvSource } from "@/lib/deploymentEnvironment";

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
