import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getStripeClient } from "@/lib/stripe";
import { BASE_URL } from "@/lib/baseUrl";

/**
 * Sends an already-onboarded host to their own Stripe Express dashboard
 * (payout history, bank details, tax info) via a fresh, single-use login
 * link - FYStay never stores or shows any of that itself.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "HOST") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  const loginLink = await stripe.accounts.createLoginLink(user.stripeConnectAccountId);
  return NextResponse.redirect(loginLink.url);
}
