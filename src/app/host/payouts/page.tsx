import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, ChevronLeft, ExternalLink, X } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isConnectReady, refreshConnectAccountStatus } from "@/lib/stripeConnect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { StripeBadge } from "@/components/StripeBadge";

export const metadata: Metadata = { title: "Payouts", robots: { index: false } };

export default async function HostPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string; error?: string }>;
}) {
  const { onboarding, error } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/host/payouts");
  if (session.user.role !== "HOST") redirect("/");

  let host = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });

  // Coming straight back from Stripe's own onboarding flow - re-read the
  // account directly rather than waiting on the account.updated webhook,
  // which may be slower to arrive (or, in local development, not wired up
  // at all).
  if (onboarding === "return" && host.stripeConnectAccountId) {
    const refreshed = await refreshConnectAccountStatus(host.stripeConnectAccountId);
    if (refreshed) host = { ...host, ...refreshed };
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
                Your listings can take bookings. For each one you receive your full nightly price
                and cleaning fee automatically - FYStay&apos;s service fee is paid by the guest on
                top - and Stripe pays it out to your bank account. You don&apos;t need to do
                anything else.
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
                <strong className="font-semibold text-foreground">
                  Guests can&apos;t book your listings until this is complete.
                </strong>{" "}
                {started
                  ? "Stripe still needs a few more details before you can be paid."
                  : "FYStay uses Stripe to pay hosts directly and securely - we never see or store your bank details."}
              </p>
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
