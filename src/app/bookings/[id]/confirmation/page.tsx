import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { BookingConfirmation } from "@/components/BookingConfirmation";
import { getActiveOfferingByCategory } from "@/lib/travelAddons";
import type { LengthOfStayDiscountLabel } from "@/lib/pricing";
import { isAbandonedReservation } from "@/lib/bookingLifecycle";
import { cancellationStanding, resolveCancellationPolicy } from "@/lib/cancellationPolicy";
import { formatStayDate } from "@/lib/format";

export const metadata: Metadata = { title: "Booking confirmed", robots: { index: false } };

export default async function BookingConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; dev_confirmed?: string }>;
}) {
  const { id } = await params;
  const { success, dev_confirmed: devConfirmed } = await searchParams;
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=/bookings/${id}/confirmation`);
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { listing: { include: { host: { select: { name: true } } } } },
  });

  if (!booking || booking.guestId !== session.user.id) {
    notFound();
  }

  // Only a guest coming back from Stripe waits here for the payment to be
  // confirmed. Anyone else with an unpaid booking is sent to pay for it (or,
  // if it lapsed, to the page explaining that) rather than watching a
  // "confirming your payment" screen for a payment that never happened.
  if (isAbandonedReservation(booking)) {
    redirect(`/bookings/${booking.id}`);
  }
  if (booking.status === "PENDING" && success !== "1" && devConfirmed !== "1") {
    redirect(`/checkout/${booking.id}`);
  }

  const policy = resolveCancellationPolicy(booking.listing);
  const standing = cancellationStanding(policy, booking.checkIn);
  const cancellationLine = standing.until
    ? standing.refundPercent === 100
      ? `Free cancellation until ${formatStayDate(standing.until)}`
      : `${standing.refundPercent}% refund if you cancel by ${formatStayDate(standing.until)}`
    : "This booking is non-refundable";

  // Same eligibility as tripExtraPurchaseError: only worth querying once
  // the stay is actually confirmed, and only the one AIRPORT_TRANSFER
  // offering - this nudge names one thing, not a whole "Complete your
  // trip" catalogue (that's what the booking detail page's TripExtrasCard
  // is for).
  const isConfirmed = booking.status === "CONFIRMED" || booking.status === "COMPLETED";
  const airportTransferOffering = isConfirmed
    ? await getActiveOfferingByCategory("AIRPORT_TRANSFER")
    : null;
  const alreadyAddedTransfer = airportTransferOffering
    ? await prisma.bookingExtra.findFirst({
        where: { bookingId: booking.id, offeringId: airportTransferOffering.id, status: "PAID" },
        select: { id: true },
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <BookingConfirmation
        bookingId={booking.id}
        airportTransfer={
          airportTransferOffering && !alreadyAddedTransfer
            ? {
                offeringId: airportTransferOffering.id,
                providerName: airportTransferOffering.providerName,
                priceCents: airportTransferOffering.priceCents,
                features: airportTransferOffering.features,
              }
            : null
        }
        initialStatus={booking.status}
        initialPaymentStatus={booking.paymentStatus}
        reference={booking.reference}
        listing={{
          title: booking.listing.title,
          city: booking.listing.city,
          country: booking.listing.country,
          photos: booking.listing.photos,
        }}
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
        guestName={booking.guestName}
        guestEmail={booking.guestEmail}
        guestPhone={booking.guestPhone}
        hostName={booking.listing.host.name}
        cancellation={{ line: cancellationLine, policy: `${policy.label} policy: ${policy.description}` }}
        refundedAmountCents={booking.refundedAmountCents}
      />
    </div>
  );
}
