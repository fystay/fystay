import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarClock, CircleCheck, DoorOpen, Hourglass, ReceiptText, Wifi } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { blockingBookingWhere, PENDING_BOOKING_HOLD_MINUTES } from "@/lib/availability";
import {
  completePastBookings,
  expireAbandonedCheckouts,
  expireStaleBookingRequests,
  isAbandonedReservation,
} from "@/lib/bookingLifecycle";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { canCancelBooking, canRequestBookingChange } from "@/lib/changeRequests";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { PhotoGallery } from "@/components/PhotoGallery";
import { BookingSummaryCard } from "@/components/BookingSummaryCard";
import { RequestChangeDialog } from "@/components/RequestChangeDialog";
import { CancelBookingButton } from "@/components/CancelBookingButton";
import { ChangeRequestStatus } from "@/components/ChangeRequestStatus";
import { bookingCancellationTerms, cancellationStanding, previewCancellation, resolveCancellationPolicy } from "@/lib/cancellationPolicy";
import { ContactHostButton } from "@/components/ContactHostButton";
import { needsDepositAuthorization } from "@/lib/securityDeposit";
import { DepositStatusCard } from "@/components/DepositStatusCard";
import { TripExtrasCard } from "@/components/TripExtrasCard";
import type { BadgeProps } from "@/components/ui/Badge";
import { formatDate, formatDateTime, formatPrice, formatStayDate, formatUkTime } from "@/lib/format";
import { buildStayQuery } from "@/lib/stayQuery";
import type { LengthOfStayDiscountLabel } from "@/lib/pricing";

export const metadata: Metadata = { title: "Booking details", robots: { index: false } };

const actionLinkClass =
  "focus-ring w-fit rounded-lg px-2 py-1 text-sm font-medium text-stone-700 hover:bg-surface-muted";

const statusVariant: Record<string, BadgeProps["variant"]> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "neutral",
  COMPLETED: "brand",
  REFUNDED: "neutral",
};

const statusLabel: Record<string, string> = {
  PENDING: "Pending payment",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  REFUNDED: "Refunded",
};

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=/bookings/${id}`);
  }

  await completePastBookings(prisma, session.user.id);
  await expireStaleBookingRequests(prisma, { guestId: session.user.id });
  await expireAbandonedCheckouts(prisma, { guestId: session.user.id });

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      listing: {
        include: {
          host: { select: { name: true, email: true, image: true } },
          bookings: {
            where: blockingBookingWhere(),
            select: { id: true, checkIn: true, checkOut: true },
          },
        },
      },
      changeRequests: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!booking || booking.guestId !== session.user.id) {
    notFound();
  }

  const latestChangeRequest = booking.changeRequests[0];
  const hasPendingChangeRequest = latestChangeRequest?.status === "PENDING";
  const showChangeRequestStatus =
    latestChangeRequest &&
    (latestChangeRequest.status === "PENDING" ||
      latestChangeRequest.status === "DECLINED" ||
      (latestChangeRequest.status === "APPROVED" &&
        latestChangeRequest.priceDeltaCents > 0 &&
        !latestChangeRequest.paidAt));

  // A paid (or since-refunded) booking is a real, confirmed reservation, so
  // it's the right moment to reveal the exact address and a direct way to
  // reach the host — neither of which the public listing page shows.
  const canSeeStayDetails =
    booking.paymentStatus === "PAID" ||
    booking.paymentStatus === "PARTIALLY_REFUNDED" ||
    booking.paymentStatus === "REFUNDED";

  // Trip extras (see docs/trip-extras-roadmap.md) - only worth querying at
  // all once this is a real, paid stay (same gate as canSeeStayDetails), so
  // a still-pending or never-paid booking never even shows the "Complete
  // your trip" card.
  const [extraOfferings, paidBookingExtras] = canSeeStayDetails
    ? await Promise.all([
        prisma.extraOffering.findMany({
          where: { active: true, provider: { active: true } },
          include: { provider: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        }),
        prisma.bookingExtra.findMany({
          where: { bookingId: booking.id, status: "PAID" },
          select: { offeringId: true },
        }),
      ])
    : [[], []];
  // Instant Book (approvalStatus stays "NONE" the whole time - there's no
  // host-approval step to move it through) has no other surface anywhere
  // in the app offering a way back to checkout for a still-unpaid
  // reservation - without this, a guest who reserves and then closes the
  // tab before paying is stuck with a permanently "Pending payment"
  // booking and no visible next step. `blockingBookingWhere` already
  // treats a PENDING hold older than this same window as freed up for
  // other guests to book (see availability.ts) - once that's happened,
  // sending this guest back to checkout would only run into the "hold
  // expired" state that page already shows, so this mirrors that same
  // cutoff rather than inventing a second one.
  const isUnpaidInstantBooking = booking.status === "PENDING" && booking.approvalStatus === "NONE";
  const now = new Date();
  const holdEndsAt = new Date(booking.createdAt.getTime() + PENDING_BOOKING_HOLD_MINUTES * 60 * 1000);
  const instantBookingHoldExpired = isUnpaidInstantBooking && holdEndsAt <= now;
  const abandoned = isAbandonedReservation(booking);
  // "Book again" lands on the listing with this stay's dates and guests
  // already chosen, not a blank calendar.
  const rebookHref = `/listings/${booking.listingId}${buildStayQuery({
    checkIn: booking.checkIn.toISOString().slice(0, 10),
    checkOut: booking.checkOut.toISOString().slice(0, 10),
    adults: String(booking.guests),
  })}`;
  const policy = resolveCancellationPolicy(bookingCancellationTerms(booking));
  // Where a paid, upcoming stay stands under its policy today - the same
  // rule the Cancel button refunds by (see cancellationStanding).
  const standing =
    booking.status === "CONFIRMED" && booking.paymentStatus === "PAID"
      ? cancellationStanding(policy, booking.checkIn, now)
      : null;
  const wasCancelledAfterPaying =
    (booking.status === "CANCELLED" || booking.status === "REFUNDED") && booking.paidAt !== null;

  const canModify = canRequestBookingChange(booking, hasPendingChangeRequest);
  const canCancel = canCancelBooking(booking);
  const canRebook =
    booking.status === "COMPLETED" || booking.status === "CANCELLED" || booking.status === "REFUNDED";

  // Request-to-book (see Listing.instantBook) overrides the plain
  // status badge while its outcome is still worth calling out
  // specifically - a guest declined by the host shouldn't read the same
  // generic "Cancelled" as one who cancelled their own trip.
  const requestBadge: { label: string; variant: BadgeProps["variant"] } | null =
    booking.approvalStatus === "AWAITING"
      ? { label: "Awaiting host approval", variant: "warning" }
      : booking.approvalStatus === "APPROVED" && booking.status === "PENDING"
        ? { label: "Approved - payment due", variant: "warning" }
        : booking.approvalStatus === "DECLINED"
          ? { label: "Request declined", variant: "neutral" }
          : booking.approvalStatus === "EXPIRED"
            ? { label: "Request expired", variant: "neutral" }
            : null;

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8 pb-24 lg:pb-8">
      <Link
        href="/bookings"
        className="focus-ring inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-stone-500 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to my trips
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{booking.listing.title}</h1>
          <p className="mt-1 text-stone-600">
            {booking.listing.city}, {booking.listing.country}
          </p>
          <p className="mt-1 text-xs font-medium text-stone-500">Booking #{booking.reference}</p>
        </div>
        <Badge variant={requestBadge?.variant ?? statusVariant[booking.status]}>
          {requestBadge?.label ?? statusLabel[booking.status] ?? booking.status}
        </Badge>
      </div>

      {isUnpaidInstantBooking && (
        <Card className="mt-4 flex flex-row items-start gap-3 border-brand-100 bg-brand-50 p-4">
          <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
          <div>
            {instantBookingHoldExpired ? (
              <>
                <p className="font-medium text-brand-900">This reservation hold has expired</p>
                <p className="text-sm text-brand-800">
                  These dates were held for {PENDING_BOOKING_HOLD_MINUTES} minutes and have since
                  been released. Book again to hold them once more.
                </p>
                <Link href={rebookHref} className={cn(buttonVariants({ size: "sm" }), "mt-3")}>
                  Book again
                </Link>
              </>
            ) : (
              <>
                <p className="font-medium text-brand-900">Payment still needed</p>
                <p className="text-sm text-brand-800">
                  We&apos;re holding these dates for you until {formatUkTime(holdEndsAt)}. Pay before
                  then to confirm your stay - you haven&apos;t been charged yet.
                </p>
                <Link
                  href={`/checkout/${booking.id}`}
                  className={cn(buttonVariants({ size: "sm" }), "mt-3")}
                >
                  Complete payment
                </Link>
              </>
            )}
          </div>
        </Card>
      )}

      {abandoned && (
        <Card className="mt-4 flex flex-row items-start gap-3 border-brand-100 bg-brand-50 p-4">
          <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
          <div>
            <p className="font-medium text-brand-900">This reservation wasn&apos;t completed</p>
            <p className="text-sm text-brand-800">
              It wasn&apos;t paid for in time, so the dates were released. You haven&apos;t been charged.
            </p>
            <Link href={rebookHref} className={cn(buttonVariants({ size: "sm" }), "mt-3")}>
              Book again
            </Link>
          </div>
        </Card>
      )}

      {wasCancelledAfterPaying && (
        <Card className="mt-4 flex flex-row items-start gap-3 p-4">
          <ReceiptText className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
          <div className="text-sm text-stone-600">
            <p className="font-medium text-foreground">This booking was cancelled</p>
            {booking.refundedAmountCents && booking.refundedAmountCents > 0 ? (
              <p className="mt-0.5">
                {formatPrice(booking.refundedAmountCents)}{" "}
                {booking.refundedAmountCents < booking.totalPriceCents && (
                  <>of the {formatPrice(booking.totalPriceCents)} you paid </>
                )}
                was refunded to your original payment method
                {booking.refundedAt && <> on {formatDate(booking.refundedAt)}</>}. Refunds usually
                take 5-10 working days to show on your statement.
              </p>
            ) : (
              <p className="mt-0.5">
                No refund was due under this stay&apos;s {policy.label.toLowerCase()} cancellation policy.
              </p>
            )}
          </div>
        </Card>
      )}

      {booking.approvalStatus !== "NONE" && (
        <Card className="mt-4 flex flex-row items-start gap-3 border-brand-100 bg-brand-50 p-4">
          <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
          <div>
            {booking.approvalStatus === "AWAITING" && (
              <>
                <p className="font-medium text-brand-900">
                  Request sent to {booking.listing.host.name}
                </p>
                <p className="text-sm text-brand-800">
                  You won&apos;t be charged unless they accept. They have until{" "}
                  {booking.requestExpiresAt ? formatDateTime(booking.requestExpiresAt) : ""} to respond.
                </p>
              </>
            )}
            {booking.approvalStatus === "APPROVED" && booking.status === "PENDING" && (
              <>
                <p className="font-medium text-brand-900">Your request was approved!</p>
                <p className="text-sm text-brand-800">
                  Complete payment to confirm your stay with {booking.listing.host.name}.
                </p>
                <Link
                  href={`/checkout/${booking.id}`}
                  className={cn(buttonVariants({ size: "sm" }), "mt-3")}
                >
                  Complete booking
                </Link>
              </>
            )}
            {booking.approvalStatus === "DECLINED" && (
              <>
                <p className="font-medium text-brand-900">Request declined</p>
                <p className="text-sm text-brand-800">
                  {booking.listing.host.name} wasn&apos;t able to accept this request. Any credit
                  you applied has been returned to your balance.
                </p>
              </>
            )}
            {booking.approvalStatus === "EXPIRED" && (
              <>
                <p className="font-medium text-brand-900">Request expired</p>
                <p className="text-sm text-brand-800">
                  {booking.listing.host.name} didn&apos;t respond in time. Any credit you applied
                  has been returned to your balance.
                </p>
              </>
            )}
          </div>
        </Card>
      )}

      {booking.depositStatus !== "NOT_REQUIRED" && (
        <DepositStatusCard
          bookingId={booking.id}
          depositStatus={booking.depositStatus}
          securityDepositCents={booking.securityDepositCents}
          depositCapturedCents={booking.depositCapturedCents}
          canAuthorizeNow={needsDepositAuthorization(booking)}
        />
      )}

      {/* The stay itself first - what, when, how much, can I cancel - then
          the place, the host and what you can do; extras and photos after. */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:mt-8 lg:grid-cols-3 lg:gap-8">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {standing && canCancel && (
            <Card>
              <CardContent className="flex items-start gap-3 p-5">
                {standing.refundPercent === 100 ? (
                  <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                ) : (
                  <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
                )}
                <div className="text-sm text-stone-600">
                  <p className="font-medium text-foreground">
                    {standing.until
                      ? standing.refundPercent === 100
                        ? `Free cancellation until ${formatStayDate(standing.until)}`
                        : `${standing.refundPercent}% refund if you cancel by ${formatStayDate(standing.until)}`
                      : "This stay can no longer be refunded"}
                  </p>
                  <p className="mt-0.5">
                    {policy.label} policy: {policy.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Where you&apos;re staying</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm text-stone-600">
              <p>
                {booking.listing.city}, {booking.listing.country}
              </p>
              {canSeeStayDetails && booking.listing.address ? (
                <p className="font-medium text-foreground">{booking.listing.address}</p>
              ) : (
                canSeeStayDetails && <p>Your host will share the exact address before you arrive.</p>
              )}
            </CardContent>
          </Card>

          {canSeeStayDetails &&
            (booking.listing.checkInTime ||
              booking.listing.checkOutTime ||
              booking.listing.checkInInstructions ||
              (booking.listing.wifiNetwork && booking.listing.wifiPassword)) && (
              <Card>
                <CardHeader>
                  <CardTitle>Check-in details</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm text-stone-600">
                  {(booking.listing.checkInTime || booking.listing.checkOutTime) && (
                    <div className="flex flex-wrap gap-x-6 gap-y-1">
                      {booking.listing.checkInTime && (
                        <span className="flex items-center gap-1.5">
                          <DoorOpen className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                          Check-in: {booking.listing.checkInTime}
                        </span>
                      )}
                      {booking.listing.checkOutTime && (
                        <span className="flex items-center gap-1.5">
                          <DoorOpen className="h-4 w-4 shrink-0 rotate-180 text-brand-600" aria-hidden />
                          Checkout: {booking.listing.checkOutTime}
                        </span>
                      )}
                    </div>
                  )}
                  {booking.listing.checkInInstructions && (
                    <p className="whitespace-pre-line rounded-xl bg-surface-muted px-3.5 py-3">
                      {booking.listing.checkInInstructions}
                    </p>
                  )}
                  {booking.listing.wifiNetwork && booking.listing.wifiPassword && (
                    <p className="flex items-center gap-1.5">
                      <Wifi className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      Wifi: <span className="font-medium text-foreground">{booking.listing.wifiNetwork}</span> · {booking.listing.wifiPassword}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

          <Card>
            <CardHeader>
              <CardTitle>Your host</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Avatar name={booking.listing.host.name} src={booking.listing.host.image} />
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{booking.listing.host.name}</p>
                  {canSeeStayDetails && booking.listing.host.email && (
                    <p className="truncate text-sm text-stone-500">{booking.listing.host.email}</p>
                  )}
                </div>
              </div>
              <ContactHostButton listingId={booking.listingId} hostName={booking.listing.host.name} isLoggedIn />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Manage this booking</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {showChangeRequestStatus && (
                <ChangeRequestStatus
                  bookingId={booking.id}
                  requestId={latestChangeRequest.id}
                  status={latestChangeRequest.status}
                  requestedCheckIn={latestChangeRequest.requestedCheckIn}
                  requestedCheckOut={latestChangeRequest.requestedCheckOut}
                  requestedGuests={latestChangeRequest.requestedGuests}
                  priceDeltaCents={latestChangeRequest.priceDeltaCents}
                  originalTotalPriceCents={latestChangeRequest.originalTotalPriceCents}
                  paidAt={latestChangeRequest.paidAt}
                />
              )}

              <div className="flex flex-col items-start gap-1">
                <Link href={`/listings/${booking.listingId}`} className={actionLinkClass}>
                  View property
                </Link>

                {canModify && (
                  <RequestChangeDialog
                    bookingId={booking.id}
                    currentCheckIn={booking.checkIn}
                    currentCheckOut={booking.checkOut}
                    currentGuests={booking.guests}
                    currentTotalPriceCents={booking.totalPriceCents}
                    pricePerNightCents={booking.listing.pricePerNightCents}
                    cleaningFeeCents={booking.listing.cleaningFeeCents}
                    weeklyDiscountPercent={booking.listing.weeklyDiscountPercent}
                    monthlyDiscountPercent={booking.listing.monthlyDiscountPercent}
                    lastMinuteDiscountPercent={booking.lastMinuteDiscountPercent}
                    minNights={booking.listing.minNights}
                    maxNights={booking.listing.maxNights}
                    maxGuests={booking.listing.maxGuests}
                    otherBookedRanges={booking.listing.bookings.filter((b) => b.id !== booking.id)}
                  />
                )}

                {canCancel && (
                  <CancelBookingButton
                    bookingId={booking.id}
                    listingTitle={booking.listing.title}
                    {...previewCancellation({
                      listing: bookingCancellationTerms(booking),
                      wasPaid: booking.paymentStatus === "PAID",
                      totalPriceCents: booking.totalPriceCents,
                      checkIn: booking.checkIn,
                    })}
                  />
                )}

                {canSeeStayDetails && (
                  <Link href={`/bookings/${booking.id}/receipt`} className={actionLinkClass}>
                    View receipt
                  </Link>
                )}

                {canRebook && !abandoned && (
                  <Link href={`/listings/${booking.listingId}`} className={actionLinkClass}>
                    Rebook this stay
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* First on a phone: the booking itself before everything else. */}
        <div className="order-first lg:order-none">
          <BookingSummaryCard
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
            reference={booking.reference}
            guestName={booking.guestName}
            guestEmail={booking.guestEmail}
            guestPhone={booking.guestPhone}
            paymentStatus={booking.paymentStatus}
          />
        </div>
      </div>

      {extraOfferings.length > 0 && (
        <div id="trip-extras" className="mt-8 scroll-mt-24">
          <TripExtrasCard
            bookingId={booking.id}
            offerings={extraOfferings.map((offering) => ({
              id: offering.id,
              name: offering.name,
              description: offering.description,
              priceCents: offering.priceCents,
              providerName: offering.provider.name,
              category: offering.category,
            }))}
            paidOfferingIds={paidBookingExtras.map((extra) => extra.offeringId)}
          />
        </div>
      )}

      <div className="mt-8">
        <PhotoGallery photos={booking.listing.photos} title={booking.listing.title} />
      </div>
    </div>
  );
}
