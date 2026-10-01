import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getStripeClient } from "@/lib/stripe";
import { hostConnectAccountParams } from "@/lib/stripeConnect";

/**
 * Starts (or resumes) a host's Stripe onboarding as a Connect recipient
 * account (Accounts v2, Express dashboard - see hostConnectAccountParams). A plain GET, not a
 * POST+fetch, so the "Connect with Stripe" button on /host/payouts can just
 * be a link - and so Stripe's own account-link refresh_url (used if a link
 * expires before the host finishes) can point straight back here to mint a
 * fresh one, rather than needing a second route.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "HOST") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.redirect(`${baseUrl}/host/payouts?error=stripe_not_configured`);
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });

  let accountId = user.stripeConnectAccountId;
  if (!accountId) {
    const account = await stripe.v2.core.accounts.create(
      hostConnectAccountParams({ email: user.email, name: user.name }),
    );
    accountId = account.id;
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeConnectAccountId: accountId },
    });
  }

  const accountLink = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient"],
        refresh_url: `${baseUrl}/api/host/stripe/connect`,
        return_url: `${baseUrl}/host/payouts?onboarding=return`,
      },
    },
  });

  return NextResponse.redirect(accountLink.url);
}
