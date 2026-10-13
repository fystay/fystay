import { NextResponse } from "next/server";
import Stripe from "stripe";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getStripeClient } from "@/lib/stripe";
import { createIdentityVerificationSession, identityStateFromSession } from "@/lib/identity";
import { BASE_URL } from "@/lib/baseUrl";
import { withApiErrorHandling } from "@/lib/apiError";
import { checkRateLimit, rateLimitedResponse, releaseRateLimitHit } from "@/lib/rateLimit";

/**
 * Starts (or resumes) a Stripe Identity check for the signed-in user and
 * hands back the hosted verification page's URL. VERIFIED only ever comes
 * from Stripe - its identity.verification_session.* webhook events, or the
 * session read back from Stripe's API (syncIdentityVerification) - this
 * endpoint itself only ever sets PENDING.
 */
async function postHandler() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json({ error: "Identity verification isn't switched on yet." }, { status: 501 });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { identityVerificationStatus: true, stripeIdentitySessionId: true },
  });
  if (user.identityVerificationStatus === "VERIFIED") {
    return NextResponse.json({ error: "You're already verified" }, { status: 409 });
  }

  // Reuse before create: a second tab, or back-then-forward, must not mint
  // a second billable session while the last one is usable - and above all
  // must not replace one Stripe is still checking, since the webhook only
  // applies to the row's current session and the result would be lost.
  if (user.stripeIdentitySessionId && user.identityVerificationStatus === "PENDING") {
    const existing = await stripe.identity.verificationSessions
      .retrieve(user.stripeIdentitySessionId)
      .catch(() => null);
    if (existing) {
      const live = identityStateFromSession(existing);
      if (live.status === "VERIFIED") {
        await prisma.user.updateMany({
          where: { id: session.user.id, stripeIdentitySessionId: existing.id },
          data: { identityVerificationStatus: "VERIFIED", identityVerifiedAt: new Date() },
        });
        return NextResponse.json({ error: "You're already verified" }, { status: 409 });
      }
      if (live.processing) {
        return NextResponse.json(
          { error: "Stripe is still checking your documents. This page will update when they're done." },
          { status: 409 },
        );
      }
      if (live.status === "PENDING" && existing.url) {
        return NextResponse.json({ url: existing.url });
      }
    }
  }

  // Each new session is a billable Stripe check, so cap restarts.
  const limitKey = `identity-start:${session.user.id}`;
  const limit = await checkRateLimit({
    key: limitKey,
    limit: 5,
    windowMs: 24 * 60 * 60 * 1000,
  });
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }

  let verificationSession: Stripe.Identity.VerificationSession;
  try {
    verificationSession = await createIdentityVerificationSession(stripe, {
      userId: session.user.id,
      returnUrl: `${BASE_URL}/account?identity=returned`,
    });
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      // A permission error means Stripe Identity isn't activated for
      // FYStay's Stripe account (identity_api_invalid_application) - only
      // the account owner can fix that, in the Stripe Dashboard. Logged with
      // Stripe's request id so it can be found in Stripe's own logs - never
      // the request itself, which names the user.
      const notActivated = error.type === "StripePermissionError";
      const details = { type: error.type, code: error.code, statusCode: error.statusCode, requestId: error.requestId };
      console.error("Stripe Identity session could not be created", details);
      Sentry.captureException(error, { tags: { area: "identity", identityNotActivated: String(notActivated) }, extra: details });
      // No session was created, so nothing was billed: don't count it.
      await releaseRateLimitHit(limitKey).catch(() => {});
      return NextResponse.json(
        {
          error: notActivated
            ? "Identity checks aren't open on FYStay yet. Nothing was charged - please try again later."
            : "Identity verification isn't available right now. Nothing was charged - please try again in a few minutes.",
        },
        { status: 503 },
      );
    }
    throw error;
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      stripeIdentitySessionId: verificationSession.id,
      identityVerificationStatus: "PENDING",
    },
  });

  return NextResponse.json({ url: verificationSession.url });
}

export const POST = withApiErrorHandling(postHandler);
