import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getStripeClient } from "@/lib/stripe";
import { BASE_URL } from "@/lib/baseUrl";

/**
 * Sends an already-onboarded host to their own Stripe Express dashboard
 * (payout history, bank details, tax info) via a fresh, single-use login
 * link - FYStay never stores or shows any of that itself. Like the connect
 * route, a page the browser lands on, so every outcome is a redirect.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(`${BASE_URL}/login?callbackUrl=${encodeURIComponent("/host/payouts")}`);
  }
  if (session.user.role !== "HOST") {
    return NextResponse.redirect(`${BASE_URL}/host`);
  }

  const baseUrl = BASE_URL;
  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.redirect(`${baseUrl}/host/payouts?error=stripe_not_configured`);
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
  if (!user.stripeConnectAccountId) {
    return NextResponse.redirect(`${baseUrl}/host/payouts`);
  }

  try {
    const loginLink = await stripe.accounts.createLoginLink(user.stripeConnectAccountId);
    return NextResponse.redirect(loginLink.url);
  } catch (error) {
    console.error("Stripe dashboard link could not be created", {
      type: error instanceof Error ? error.name : typeof error,
    });
    Sentry.captureException(error, { tags: { area: "payments" } });
    return NextResponse.redirect(`${baseUrl}/host/payouts?error=dashboard_failed`);
  }
}
