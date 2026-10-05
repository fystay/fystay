import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Info } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PENDING_BOOKING_HOLD_MINUTES } from "@/lib/availability";
import { resolveCancellationPolicy } from "@/lib/cancellationPolicy";
import { BookingSummaryCard } from "@/components/BookingSummaryCard";
import { CheckoutForm } from "@/components/CheckoutForm";
import { Card, CardContent } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { LengthOfStayDiscountLabel } from "@/lib/pricing";

export const metadata: Metadata = { title: "Confirm and pay", robots: { index: false } };

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const { bookingId } = await params;
  const { cancelled } = await searchParams;
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=/checkout/${bookingId}`);
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { listing: true },
  });

  if (!booking || booking.guestId !== session.user.id) {
    notFound();
  }

  if (booking.status !== "PENDING") {
    redirect(`/bookings/${booking.id}/confirmation`);
  }
  // Awaiting a host decision (see Listing.instantBook) - nothing to pay for
  // yet, so send the guest to their booking's own status page instead of a
  // payment form they can't use.
  if (booking.approvalStatus === "AWAITING") {
    redirect(`/bookings/${booking.id}`);
  }

  const holdExpiresAt = new Date(
    booking.createdAt.getTime() + PENDING_BOOKING_HOLD_MINUTES * 60 * 1000,
  );
  const expired = holdExpiresAt <= new Date();
  const cancellationPolicy = resolveCancellationPolicy(booking.listing);

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <Link
        href={`/listings/${booking.listingId}`}
        className="focus-ring -ml-1 inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-stone-600 hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to listing
      </Link>

      <h1 className="mt-3 text-2xl font-bold text-foreground">Confirm and pay</h1>

      {cancelled === "1" && !expired && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Info className="h-4 w-4 shrink-0" />
          Payment was cancelled. Your dates are still held, so you can try again whenever
          you&apos;re ready.
        </div>
      )}

      {expired ? (
        <Card className="mt-6 p-6 text-center">
          <CardContent className="flex flex-col items-center gap-3 p-0">
            <p className="font-medium text-foreground">This reservation hold has expired</p>
            <p className="max-w-sm text-sm text-stone-500">
              We held these dates for {PENDING_BOOKING_HOLD_MINUTES} minutes while you checked
              out. Please go back and select your dates again.
            </p>
            <Link
              href={`/listings/${booking.listingId}`}
              className={cn(buttonVariants(), "mt-2")}
            >
              Back to listing
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <CheckoutForm
              bookingId={booking.id}
              defaultName={booking.guestName ?? session.user.name ?? ""}
              defaultEmail={booking.guestEmail ?? session.user.email ?? ""}
              defaultPhone={booking.guestPhone ?? ""}
              guests={booking.guests}
              totalPriceCents={booking.totalPriceCents}
            />
          </div>
          <div className="lg:col-span-2">
            <BookingSummaryCard
              listing={booking.listing}
              checkIn={booking.checkIn}
              checkOut={booking.checkOut}
              nights={booking.nights}
              guests={booking.guests}
              nightlyPriceCents={booking.nightlyPriceCents}
              lengthOfStayDiscountCents={booking.lengthOfStayDiscountCents}
              lengthOfStayDiscountLabel={booking.lengthOfStayDiscountLabel as LengthOfStayDiscountLabel | null}
              cleaningFeeCents={booking.cleaningFeeCents}
              serviceFeeCents={booking.serviceFeeCents}
              taxCents={booking.taxCents}
              creditAppliedCents={booking.creditAppliedCents}
              securityDepositCents={booking.securityDepositCents}
              totalPriceCents={booking.totalPriceCents}
              cancellationPolicyLabel={cancellationPolicy.label}
              cancellationPolicyDescription={cancellationPolicy.description}
            />
          </div>
        </div>
      )}
    </div>
  );
}
