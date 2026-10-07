import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Hourglass, Info } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PENDING_BOOKING_HOLD_MINUTES } from "@/lib/availability";
import { bookingCancellationTerms, resolveCancellationPolicy } from "@/lib/cancellationPolicy";
import { BookingSummaryCard } from "@/components/BookingSummaryCard";
import { CheckoutForm } from "@/components/CheckoutForm";
import { Card, CardContent } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { LengthOfStayDiscountLabel } from "@/lib/pricing";
import { formatUkTime } from "@/lib/format";
import { buildStayQuery } from "@/lib/stayQuery";
import { isAbandonedReservation } from "@/lib/bookingLifecycle";

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

  // Back to the listing with this stay still chosen, not a blank calendar.
  const listingHref = `/listings/${booking.listingId}${buildStayQuery({
    checkIn: booking.checkIn.toISOString().slice(0, 10),
    checkOut: booking.checkOut.toISOString().slice(0, 10),
    adults: String(booking.guests),
  })}`;

  // A reservation that lapsed unpaid explains itself on its own page.
  if (isAbandonedReservation(booking)) {
    redirect(`/bookings/${booking.id}`);
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

  // An approved request's hold starts when the host approved it, an instant
  // booking's when it was made (see isBookingHoldActive).
  const holdStartedAt =
    booking.approvalStatus === "APPROVED" && booking.hostRespondedAt ? booking.hostRespondedAt : booking.createdAt;
  const holdExpiresAt = new Date(holdStartedAt.getTime() + PENDING_BOOKING_HOLD_MINUTES * 60 * 1000);
  const expired = holdExpiresAt <= new Date();
  const cancellationPolicy = resolveCancellationPolicy(bookingCancellationTerms(booking));
  // A returning guest isn't asked for the same phone number every time: the
  // one on their last booking (or their verified account number) is filled in.
  const knownPhone =
    booking.guestPhone ??
    (
      await prisma.booking.findFirst({
        where: { guestId: session.user.id, guestPhone: { not: null }, id: { not: booking.id } },
        orderBy: { createdAt: "desc" },
        select: { guestPhone: true },
      })
    )?.guestPhone ??
    (await prisma.user.findUnique({ where: { id: session.user.id }, select: { phone: true } }))?.phone ??
    "";

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <Link
        href={listingHref}
        className="focus-ring -ml-1 inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-stone-600 hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to listing
      </Link>

      <h1 className="mt-3 text-2xl font-bold text-foreground">Confirm and pay</h1>

      {!expired && (
        <p className="mt-2 flex items-center gap-2 text-sm text-stone-600">
          <Hourglass className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
          We&apos;re holding these dates for you until {formatUkTime(holdExpiresAt)}. You won&apos;t be
          charged until you pay.
        </p>
      )}

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
            <p className="font-medium text-foreground">Your hold on these dates has ended</p>
            <p className="max-w-sm text-sm text-stone-500">
              We hold dates for {PENDING_BOOKING_HOLD_MINUTES} minutes while you check out, and
              you haven&apos;t been charged. Go back to reserve them again - if they&apos;re still
              free, it takes one tap.
            </p>
            <Link href={listingHref} className={cn(buttonVariants(), "mt-2")}>
              Reserve again
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
              defaultPhone={knownPhone}
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
              promoDiscountCents={booking.promoDiscountCents}
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
