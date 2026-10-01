import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getStripeClient } from "@/lib/stripe";
import { createIdentityVerificationSession } from "@/lib/identity";
import { BASE_URL } from "@/lib/baseUrl";

/**
 * Starts (or restarts) a Stripe Identity check for the signed-in user and
 * hands back the hosted verification page's URL. The actual VERIFIED/FAILED
 * decision only ever comes from Stripe's own
 * identity.verification_session.* webhook events (see the Stripe webhook
 * route) - this endpoint only ever sets PENDING.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json({ error: "Identity verification is not available right now" }, { status: 501 });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { identityVerificationStatus: true, stripeIdentitySessionId: true },
  });
  if (user.identityVerificationStatus === "VERIFIED") {
    return NextResponse.json({ error: "You're already verified" }, { status: 409 });
  }

  // A guest re-opening this page (a second tab, hitting back then forward)
  // must not mint a second billable Identity session while their last one
  // is still usable - the same "reuse before create" reasoning as
  // decideExistingSessionAction for Checkout sessions.
  if (user.identityVerificationStatus === "PENDING" && user.stripeIdentitySessionId) {
    const existing = await stripe.identity.verificationSessions.retrieve(user.stripeIdentitySessionId);
    if (existing.status === "requires_input" && existing.url) {
      return NextResponse.json({ url: existing.url });
    }
  }

  const baseUrl = BASE_URL;
  const verificationSession = await createIdentityVerificationSession(stripe, {
    userId: session.user.id,
    returnUrl: `${baseUrl}/account`,
  });

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      stripeIdentitySessionId: verificationSession.id,
      identityVerificationStatus: "PENDING",
    },
  });

  return NextResponse.json({ url: verificationSession.url });
}
