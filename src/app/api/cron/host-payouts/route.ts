import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/apiError";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronMonitor } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { runHostPayouts } from "@/lib/hostPayouts";

/**
 * Daily: pays each host's released money out to their bank - 89 days after
 * the guest paid, just inside Stripe's 90-day limit (see src/lib/hostPayouts.ts).
 */
async function getHandler(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 501 });
  }
  const results = await runHostPayouts(stripe, prisma);
  return NextResponse.json({
    ranAt: new Date().toISOString(),
    hosts: results.length,
    paidOutCents: results.reduce((sum, result) => sum + result.paidOutCents, 0),
    failed: results.filter((result) => result.error).length,
  });
}

export const GET = withCronMonitor("host-payouts", "0 11 * * *", "CRON_SECRET", withApiErrorHandling(getHandler));
