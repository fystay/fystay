"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders the page every few seconds for about a minute, so a host who
 * has just finished Stripe's onboarding sees their payouts switch on by
 * themselves - Stripe often takes a few seconds after the host returns to
 * activate the account, and each render re-reads the status from Stripe.
 * Stops on its own once the page no longer renders it (payouts active).
 */
export function RefreshWhileStripeFinishes({ everyMs = 4000, times = 15 }: { everyMs?: number; times?: number }) {
  const router = useRouter();
  useEffect(() => {
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      if (count > times) {
        window.clearInterval(timer);
        return;
      }
      if (!document.hidden) router.refresh();
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [router, everyMs, times]);
  return null;
}
