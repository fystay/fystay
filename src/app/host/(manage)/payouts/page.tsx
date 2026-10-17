import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, ChevronLeft, ExternalLink, X } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isConnectReady, loadConnectAccountStatus, type ConnectRequirements } from "@/lib/stripeConnect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { StripeBadge } from "@/components/StripeBadge";
import { getStripeClient } from "@/lib/stripe";
import { RefreshWhileStripeFinishes } from "@/components/RefreshWhileStripeFinishes";
import { hostCommissionText } from "@/lib/pricingPolicy";
import { smartPricingMode } from "@/lib/smartPricingMode";

export const metadata: Metadata = { title: "Payouts", robots: { index: false } };

export default async function HostPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string; error?: string }>;
}) {
  const { onboarding, error } = await searchParams;
  const session = await auth();
  // Without Stripe (local development) listings aren't held back, so don't say they are.
  const stripeConfigured = Boolean(getStripeClient());
  if (!session?.user) redirect("/login?callbackUrl=/host/payouts");
  if (session.user.role !== "HOST") redirect("/host");

  let host = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });

  // Until payouts are active, every visit re-reads the account from Stripe -
  // coming back from onboarding, refreshing, or arriving later - rather than
  // waiting on the account.updated webhook, which may be slower to arrive
  // (or, in local development, not wired up at all). Returning from Stripe
  // proves nothing by itself; only what Stripe reports is shown. If Stripe
  // can't be reached, the last stored status stands and the page says so.
  let requirements: ConnectRequirements | null = null;
  let statusUnavailable = false;
  if (host.stripeConnectAccountId && (!isConnectReady(host) || onboarding === "return")) {
    try {
      const live = await loadConnectAccountStatus(host.stripeConnectAccountId);
      if (live) {
        host = { ...host, ...live.flags };
        requirements = live.requirements;
      }
    } catch (error) {
      console.error("Couldn't read Connect status for payouts page", {
        type: error instanceof Error ? error.name : typeof error,
      });
      statusUnavailable = true;
    }
  }

  const ready = isConnectReady(host);
  const started = Boolean(host.stripeConnectAccountId);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <Link
        href="/host/dashboard"
        className="focus-ring -ml-1 inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-stone-600 hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to dashboard
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-foreground">Payouts</h1>
      <p className="mt-1 text-sm text-stone-500">
        Connect a Stripe account so guest payments pay you out directly.
      </p>

      {error === "stripe_not_configured" && (
        <Card className="mt-6 border-amber-200 bg-amber-50">
          <CardContent className="pt-5 text-sm text-amber-900">
            Payouts aren&apos;t configured for this environment yet. Try again once FYStay&apos;s
            Stripe keys are set up.
          </CardContent>
        </Card>
      )}

      {error === "connect_unavailable" && (
        <Notice tone="amber" title="Payout setup isn't open yet">
          FYStay is finishing its own setup with Stripe, so new payout accounts can&apos;t be
          created just now. Nothing was saved and you haven&apos;t been charged. We&apos;ve been told
          about it - please try again later.
        </Notice>
      )}

      {error === "connect_failed" && (
        <Notice tone="red" title="We couldn't open Stripe">
          Something went wrong starting your payout setup. Nothing was saved. Please try again in a
          moment - if it keeps happening, contact us.
        </Notice>
      )}

      {error === "dashboard_failed" && (
        <Notice tone="red" title="We couldn't open your Stripe dashboard">
          Please try again in a moment.
        </Notice>
      )}

      {statusUnavailable && (
        <Notice tone="amber" title="Couldn't check with Stripe">
          We couldn&apos;t reach Stripe to check your latest status, so this page shows what we last
          heard. Refresh to try again.
        </Notice>
      )}

      {error === "email_not_verified" && (
        <Card className="mt-6 border-amber-200 bg-amber-50">
          <CardContent className="pt-5 text-sm text-amber-900">
            Please confirm your email address before connecting payouts - booking notifications go
            there. Use the link we emailed you, or{" "}
            <Link href="/account" className="font-medium underline">
              send a new one from your account
            </Link>
            .
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Stripe account</CardTitle>
            <StripeBadge />
          </div>
          {ready ? (
            <Badge variant="success">Payouts active</Badge>
          ) : started ? (
            <Badge variant="warning">Onboarding incomplete</Badge>
          ) : (
            <Badge variant="neutral">Not connected</Badge>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {ready ? (
            <>
              <p className="text-sm text-stone-600">
                Your listings can take bookings. For each one you receive the booking total less
                FYStay&apos;s commission of {hostCommissionText(smartPricingMode())} automatically, and Stripe pays it out to your bank
                account. You don&apos;t need to do anything else.
              </p>
              <a
                href="/api/host/stripe/dashboard"
                className={cn(buttonVariants({ variant: "secondary" }), "self-start")}
              >
                Open Stripe dashboard
                <ExternalLink className="h-4 w-4" />
              </a>
            </>
          ) : (
            <>
              <p className="text-sm text-stone-600">
                {stripeConfigured && (
                  <>
                    <strong className="font-semibold text-foreground">
                      Your listings stay hidden from guests until this is complete.
                    </strong>{" "}
                  </>
                )}
                {started && requirements?.due.length === 0
                  ? "Almost there - Stripe is finishing setting up your account."
                  : started
                  ? "Stripe still needs a few more details before you can be paid."
                  : "FYStay uses Stripe to pay hosts directly and securely - we never see or store your bank details."}
              </p>
              {requirements && <RequirementsNotice requirements={requirements} />}
              {/* Nothing left for the host to do: Stripe is just switching the
                  account on, usually within seconds of their return. */}
              {requirements && requirements.due.length === 0 && <RefreshWhileStripeFinishes />}
              <ul className="flex flex-col gap-1.5 text-sm text-stone-600">
                <ChecklistItem label="Details submitted" done={host.stripeConnectDetailsSubmitted} />
                <ChecklistItem label="Can receive booking payouts" done={host.stripeConnectChargesEnabled} />
                <ChecklistItem label="Payouts to your bank enabled" done={host.stripeConnectPayoutsEnabled} />
              </ul>
              <a href="/api/host/stripe/connect" className={cn(buttonVariants(), "self-start")}>
                {started ? "Finish onboarding" : "Connect with Stripe"}
              </a>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChecklistItem({ label, done }: { label: string; done: boolean }) {
  return (
    <li className="flex items-center gap-2">
      {done ? (
        <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
      ) : (
        <X className="h-4 w-4 shrink-0 text-stone-300" aria-hidden />
      )}
      {label}
    </li>
  );
}

function Notice({ tone, title, children }: { tone: "amber" | "red"; title: string; children: React.ReactNode }) {
  return (
    <Card
      role="alert"
      className={cn("mt-6", tone === "amber" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50")}
    >
      <CardContent className={cn("pt-5 text-sm", tone === "amber" ? "text-amber-900" : "text-red-900")}>
        <p className="font-semibold">{title}</p>
        <p className="mt-1">{children}</p>
      </CardContent>
    </Card>
  );
}

/** What Stripe still needs, in Stripe's own plain words - never the details already given. */
function RequirementsNotice({ requirements }: { requirements: ConnectRequirements }) {
  const { due, overdue, reviewing, rejected } = requirements;
  if (due.length > 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">
          {rejected
            ? "Stripe couldn't verify some of your details."
            : overdue
              ? "Stripe needs these details now:"
              : "Stripe still needs:"}
        </p>
        <ul className="mt-1 list-disc pl-5">
          {due.slice(0, 6).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-1.5">Use the button below to continue on Stripe.</p>
      </div>
    );
  }
  return (
    <p role="status" className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
      {reviewing
        ? "You've sent Stripe everything it asked for. Stripe is checking your details - this usually takes a few minutes but can take a couple of days."
        : "You've sent Stripe everything it asked for. Stripe is finishing setting up your account - this usually takes a few seconds."}{" "}
      This page updates by itself.
    </p>
  );
}
