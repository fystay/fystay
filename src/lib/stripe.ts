import Stripe from "stripe";
import { isProductionDeployment, type EnvSource } from "@/lib/deploymentEnvironment";

export function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
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
