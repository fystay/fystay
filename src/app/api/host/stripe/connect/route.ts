import { NextResponse } from "next/server";
import Stripe from "stripe";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getStripeClient } from "@/lib/stripe";
import { hostConnectAccountParams } from "@/lib/stripeConnect";
import { ensureManualPayouts } from "@/lib/hostPayouts";
import { BASE_URL } from "@/lib/baseUrl";

/**
 * Starts (or resumes) a host's Stripe onboarding as a Connect recipient
 * account (Accounts v2, Express dashboard - see hostConnectAccountParams). A plain GET, not a
 * POST+fetch, so the "Connect with Stripe" button on /host/payouts can just
 * be a link - and so Stripe's own account-link refresh_url (used if a link
 * expires before the host finishes) can point straight back here to mint a
 * fresh one, rather than needing a second route.
 *
 * Because it's a page the host's browser lands on, every outcome is a
 * redirect - to Stripe, or back to /host/payouts with a reason the page
 * explains - never a bare JSON error.
 */

// Stripe codes meaning FYStay's own Stripe platform isn't set up to create
// host accounts yet (a Dashboard step only the account owner can do), as
// opposed to a passing failure worth retrying.
const PLATFORM_SETUP_CODES = new Set([
  "account_creation_losses_collector_unavailable",
  "platform_account_required",
  "platform_api_key_expired",
]);

function payoutsRedirect(reason: string) {
  return NextResponse.redirect(`${BASE_URL}/host/payouts?error=${reason}`);
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(`${BASE_URL}/login?callbackUrl=${encodeURIComponent("/host/payouts")}`);
  }
  if (session.user.role !== "HOST") {
    return NextResponse.redirect(`${BASE_URL}/host`);
  }

  const stripe = getStripeClient();
  if (!stripe) return payoutsRedirect("stripe_not_configured");

  let step: "account" | "link" = "account";
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });

    // Booking notifications and payout correspondence go to this address, so
    // a host only becomes payable once they've proved it's theirs - otherwise
    // a mistyped (or someone else's) email takes real bookings nobody hears
    // about. Google sign-in accounts arrive verified.
    if (!user.emailVerifiedAt) return payoutsRedirect("email_not_verified");

    // One Stripe account per host, ever: an existing one is always resumed,
    // and a new one is only stored if the host still has none - so a double
    // click or two tabs can't leave the host pointing at two accounts.
    let accountId = user.stripeConnectAccountId;
    if (!accountId) {
      const account = await stripe.v2.core.accounts.create(
        hostConnectAccountParams({ userId: user.id, email: user.email, name: user.name }),
      );
      const stored = await prisma.user.updateMany({
        where: { id: user.id, stripeConnectAccountId: null },
        data: { stripeConnectAccountId: account.id },
      });
      if (stored.count === 1) {
        accountId = account.id;
        // Payouts wait until after the stay (src/lib/hostPayouts.ts). The
        // daily host-payouts run also sets this, so a failure here never
        // blocks onboarding.
        await ensureManualPayouts(stripe, account.id).catch((error) =>
          console.warn("Could not set manual payouts on a new host account yet", {
            account: account.id,
            code: error instanceof Stripe.errors.StripeError ? error.code : undefined,
          }),
        );
      } else {
        // Another request stored one first - use that, leave this one unused.
        const winner = await prisma.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { stripeConnectAccountId: true },
        });
        console.warn("Connect account created twice for one host; using the stored one", {
          unused: account.id,
        });
        accountId = winner.stripeConnectAccountId!;
      }
    }

    step = "link";
    // A fresh link every time: links are single-use and expire, so a host
    // coming back (or Stripe sending them to refresh_url) always gets a new one.
    const accountLink = await stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["recipient"],
          refresh_url: `${BASE_URL}/api/host/stripe/connect`,
          return_url: `${BASE_URL}/host/payouts?onboarding=return`,
        },
      },
    });

    return NextResponse.redirect(accountLink.url);
  } catch (error) {
    // Enough to find the request in Stripe's logs - never the request body,
    // which carries the host's name and email.
    const details =
      error instanceof Stripe.errors.StripeError
        ? { type: error.type, code: error.code, statusCode: error.statusCode, requestId: error.requestId }
        : { type: error instanceof Error ? error.name : typeof error };
    console.error("Stripe Connect onboarding could not start", { step, ...details });
    Sentry.captureException(error, { tags: { area: "payments", connectStep: step }, extra: details });

    const platformNotReady =
      error instanceof Stripe.errors.StripeError &&
      (error.type === "StripePermissionError" || (error.code !== undefined && PLATFORM_SETUP_CODES.has(error.code)));
    return payoutsRedirect(platformNotReady ? "connect_unavailable" : "connect_failed");
  }
}
