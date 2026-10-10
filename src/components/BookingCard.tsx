"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, ImageOff } from "lucide-react";
import { trackAddonEvent } from "@/lib/analytics";
import { useViewOnce } from "@/hooks/useViewOnce";
import { travelAddonHref } from "@/lib/travelAddons";
import { formatPrice, formatStayDate } from "@/lib/format";
import { canReviewBooking } from "@/lib/reviews";
import { canCancelBooking, canRequestBookingChange } from "@/lib/changeRequests";
import { bookingCancellationTerms, previewCancellation, type CancellationPolicyKind } from "@/lib/cancellationPolicy";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { StarRating } from "@/components/ui/StarRating";
import { ReviewForm } from "@/components/ReviewForm";
import { CancelBookingButton } from "@/components/CancelBookingButton";
import { RequestChangeDialog } from "@/components/RequestChangeDialog";
import { ChangeRequestStatus } from "@/components/ChangeRequestStatus";
import { isOptimizableImage } from "@/lib/image";

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

export type BookingCardChangeRequest = {
  id: string;
  status: "PENDING" | "APPROVED" | "DECLINED";
  requestedCheckIn: Date;
  requestedCheckOut: Date;
  requestedGuests: number;
  priceDeltaCents: number;
  originalTotalPriceCents: number;
  paidAt: Date | null;
};

export type BookingCardBooking = {
  id: string;
  reference: string;
  listingId: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "REFUNDED";
  paymentStatus: "UNPAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";
  approvalStatus: "NONE" | "AWAITING" | "APPROVED" | "DECLINED" | "EXPIRED";
  checkIn: Date;
  checkOut: Date;
  guests: number;
  lastMinuteDiscountPercent?: number | null;
  totalPriceCents: number;
  /** The booking's own snapshotted rates and discounts - what a date change is priced from. */
  nightlyPriceCents: number;
  weekendNightlyPriceCents: number | null;
  cleaningFeeCents: number;
  creditAppliedCents: number;
  promoDiscountCents: number;
  /** When the guest paid - starts a non-refundable policy's 24-hour full-refund window. */
  paidAt?: Date | null;
  /** What was actually refunded on a cancelled, paid booking (may be part or none). */
  refundedAmountCents?: number | null;
  review: { rating: number } | null;
  /** The terms agreed at booking (see bookingCancellationTerms). */
  cancellationPolicy?: CancellationPolicyKind | null;
  customCancellationCutoffDays?: number | null;
  customCancellationRefundPercent?: number | null;
  listing: {
    title: string;
    city: string;
    country: string;
    photos: string[];
    pricePerNightCents: number;
    cleaningFeeCents: number;
    weeklyDiscountPercent: number | null;
    monthlyDiscountPercent: number | null;
    minNights: number;
    maxNights: number | null;
    maxGuests: number;
    cancellationPolicy: CancellationPolicyKind;
    customCancellationCutoffDays: number | null;
    customCancellationRefundPercent: number | null;
    bookings: { id: string; checkIn: Date; checkOut: Date }[];
  };
};

export function BookingCard({
  booking,
  latestChangeRequest,
  hasAirportTransfer,
  airportTransferProviderName,
}: {
  booking: BookingCardBooking;
  latestChangeRequest: BookingCardChangeRequest | undefined;
  hasAirportTransfer: boolean;
  airportTransferProviderName: string | null;
}) {
  // Optimistic overrides: reflect a guest action instantly, before the
  // background request (and the eventual router.refresh()) confirms it.
  const [optimisticStatus, setOptimisticStatus] = useState<typeof booking.status | null>(null);
  const [changeRequestWithdrawn, setChangeRequestWithdrawn] = useState(false);

  const status = optimisticStatus ?? booking.status;
  const effectiveBooking = { ...booking, status };
  const effectiveChangeRequest = changeRequestWithdrawn ? undefined : latestChangeRequest;

  const hasPendingChangeRequest = effectiveChangeRequest?.status === "PENDING";
  const showChangeRequestStatus =
    effectiveChangeRequest &&
    (effectiveChangeRequest.status === "PENDING" ||
      effectiveChangeRequest.status === "DECLINED" ||
      (effectiveChangeRequest.status === "APPROVED" &&
        effectiveChangeRequest.priceDeltaCents > 0 &&
        !effectiveChangeRequest.paidAt));
  const showActions =
    canCancelBooking(effectiveBooking) ||
    canRequestBookingChange(effectiveBooking, hasPendingChangeRequest);
  // A PENDING booking still awaiting a host's request-to-book decision has
  // nothing to pay for yet (see approvalStatus's own schema comment) - this
  // only fires once there either is no approval step at all (Instant Book)
  // or the host has already approved it, the two cases where a guest can
  // actually complete checkout right now. Without this, this card's only
  // links were "View details" and (once available) "Cancel" - no way back
  // to checkout for a reservation that's simply sitting unpaid.
  const needsPayment = status === "PENDING" && effectiveBooking.approvalStatus !== "AWAITING";

  // "Your journey" (item 5 of the cross-sell brief in
  // docs/trip-extras-roadmap.md) only makes sense once the stay itself is
  // actually going ahead - the same CONFIRMED/COMPLETED gate
  // tripExtraPurchaseError applies to buying a transfer at all - and only
  // when there's a real, active offering to point the CTA at.
  const showJourney =
    airportTransferProviderName !== null && (status === "CONFIRMED" || status === "COMPLETED");
  const journeyViewRef = useViewOnce<HTMLDivElement>(() => {
    trackAddonEvent({
      name: "transfer_offer_viewed",
      category: "AIRPORT_TRANSFER",
      surface: "account",
      bookingId: booking.id,
    });
  });

  function handleBookTransferClick() {
    trackAddonEvent({
      name: "transfer_offer_clicked",
      category: "AIRPORT_TRANSFER",
      surface: "account",
      bookingId: booking.id,
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex gap-4 sm:min-w-0 sm:flex-1">
          <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
            {booking.listing.photos[0] ? (
              <Image
                src={booking.listing.photos[0]}
                alt={booking.listing.title}
                fill
                className="object-cover"
                sizes="112px"
                unoptimized={!isOptimizableImage(booking.listing.photos[0])}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-stone-400">
                <ImageOff className="h-5 w-5" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <Link
              href={`/listings/${booking.listingId}`}
              className="block line-clamp-2 font-medium text-foreground hover:text-brand-700"
            >
              {booking.listing.title}
            </Link>
            <p className="text-sm text-stone-500">
              {booking.listing.city}, {booking.listing.country}
            </p>
            <p className="text-sm text-stone-500">
              {formatStayDate(booking.checkIn)} – {formatStayDate(booking.checkOut)} ·{" "}
              {booking.guests} guest{booking.guests > 1 ? "s" : ""}
            </p>
            <p className="text-xs text-stone-500">Booking #{booking.reference}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 sm:block sm:shrink-0 sm:text-right">
          <div>
            <p className="font-semibold text-foreground">{formatPrice(booking.totalPriceCents)}</p>
            {(status === "CANCELLED" || status === "REFUNDED") && booking.paymentStatus !== "UNPAID" && (
              <p className="text-xs text-stone-500">
                {booking.refundedAmountCents ? `${formatPrice(booking.refundedAmountCents)} refunded` : "No refund due"}
              </p>
            )}
          </div>
          <Badge variant={statusVariant[status]} className="sm:mt-1">
            {statusLabel[status] ?? status}
          </Badge>
        </div>
      </div>

      {booking.review ? (
        <div className="flex items-center gap-1.5 text-sm text-stone-500">
          <StarRating rating={booking.review.rating} size={14} />
          You reviewed this stay
        </div>
      ) : (
        canReviewBooking(effectiveBooking) && (
          <ReviewForm bookingId={booking.id} listingTitle={booking.listing.title} />
        )
      )}

      {showChangeRequestStatus && (
        <ChangeRequestStatus
          bookingId={booking.id}
          requestId={effectiveChangeRequest.id}
          status={effectiveChangeRequest.status}
          requestedCheckIn={effectiveChangeRequest.requestedCheckIn}
          requestedCheckOut={effectiveChangeRequest.requestedCheckOut}
          requestedGuests={effectiveChangeRequest.requestedGuests}
          priceDeltaCents={effectiveChangeRequest.priceDeltaCents}
          originalTotalPriceCents={effectiveChangeRequest.originalTotalPriceCents}
          paidAt={effectiveChangeRequest.paidAt}
          onWithdrawn={() => setChangeRequestWithdrawn(true)}
          onWithdrawFailed={() => setChangeRequestWithdrawn(false)}
        />
      )}

      {showJourney && (
        <div ref={journeyViewRef} className="rounded-xl border border-border-subtle p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Your journey
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-stone-700">
              <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              Stay
            </div>
            {hasAirportTransfer ? (
              <div className="flex items-center gap-2 text-sm text-stone-700">
                <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Airport transfer
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg bg-surface-muted p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Airport transfer not booked</p>
                  <p className="text-xs text-stone-500">
                    Need a ride from the airport? Arrange your {airportTransferProviderName} transfer.
                  </p>
                </div>
                <Link
                  href={travelAddonHref("AIRPORT_TRANSFER")}
                  onClick={handleBookTransferClick}
                  className="focus-ring shrink-0 self-start rounded-lg border border-border-subtle px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface sm:self-auto"
                >
                  Book {airportTransferProviderName} transfer
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
        <div className="flex flex-wrap items-center gap-1">
          <Link
            href={`/bookings/${booking.id}`}
            className="focus-ring rounded-lg px-2 py-1 text-sm font-medium text-stone-700 hover:bg-surface-muted"
          >
            View details
          </Link>
          {needsPayment && (
            <Link href={`/checkout/${booking.id}`} className={buttonVariants({ size: "sm" })}>
              Complete payment
            </Link>
          )}
        </div>

        {showActions && (
          <div className="flex flex-wrap items-center gap-1">
            {canRequestBookingChange(effectiveBooking, hasPendingChangeRequest) && (
              <RequestChangeDialog
                bookingId={booking.id}
                currentCheckIn={booking.checkIn}
                currentCheckOut={booking.checkOut}
                currentGuests={booking.guests}
                priceBasis={{
                  nightlyPriceCents: booking.nightlyPriceCents,
                  weekendNightlyPriceCents: booking.weekendNightlyPriceCents,
                  cleaningFeeCents: booking.cleaningFeeCents,
                  lastMinuteDiscountPercent: booking.lastMinuteDiscountPercent ?? null,
                  totalPriceCents: booking.totalPriceCents,
                  creditAppliedCents: booking.creditAppliedCents,
                  promoDiscountCents: booking.promoDiscountCents,
                }}
                weeklyDiscountPercent={booking.listing.weeklyDiscountPercent}
                monthlyDiscountPercent={booking.listing.monthlyDiscountPercent}
                minNights={booking.listing.minNights}
                maxNights={booking.listing.maxNights}
                maxGuests={booking.listing.maxGuests}
                otherBookedRanges={booking.listing.bookings.filter((b) => b.id !== booking.id)}
              />
            )}
            {canCancelBooking(effectiveBooking) && (
              <CancelBookingButton
                bookingId={booking.id}
                listingTitle={booking.listing.title}
                {...previewCancellation({
                  listing: bookingCancellationTerms(booking),
                  wasPaid: booking.paymentStatus === "PAID",
                  totalPriceCents: booking.totalPriceCents,
                  checkIn: booking.checkIn,
                  paidAt: booking.paidAt,
                })}
                onCancelled={() => setOptimisticStatus("CANCELLED")}
                onCancelFailed={() => setOptimisticStatus(null)}
              />
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
