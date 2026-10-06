"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CalendarDays, ImageOff, MessageSquare, PencilLine, Star } from "lucide-react";
import { formatPrice, formatStayDate } from "@/lib/format";
import { DeleteListingButton } from "@/components/DeleteListingButton";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { isOptimizableImage } from "@/lib/image";
import { hostPayoutCents, hostRevenueCents } from "@/lib/hostStats";

const bookingStatusVariant = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "neutral",
  COMPLETED: "brand",
  REFUNDED: "neutral",
} as const;

const bookingStatusLabel = {
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  REFUNDED: "Refunded",
} as const;

/** Plain words for the host: a pending booking is either theirs to approve or the guest's to pay. */
function statusLabel(booking: { status: keyof typeof bookingStatusVariant; approvalStatus: string }): string {
  if (booking.status !== "PENDING") return bookingStatusLabel[booking.status];
  return booking.approvalStatus === "PENDING" ? "Needs your reply" : "Awaiting payment";
}

// A listing can accumulate dozens of confirmed future bookings; dumping
// every one inline turns the dashboard into an unreadable wall of rows, so
// only a handful show by default with a toggle to reveal the rest.
const INITIAL_VISIBLE_BOOKINGS = 3;

const paymentStatusLabel: Record<string, string> = {
  UNPAID: "Unpaid",
  PAID: "Paid, not refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Fully refunded",
};

type ChangeRequestRow = {
  id: string;
  status: "PENDING" | "APPROVED" | "DECLINED";
  requestedCheckIn: Date;
  requestedCheckOut: Date;
  requestedGuests: number;
  priceDeltaCents: number;
  originalCheckIn: Date;
  originalCheckOut: Date;
  originalGuests: number;
  originalTotalPriceCents: number;
};

export type HostListingStats = {
  avgRating: number | null;
  reviewCount: number;
  occupancyRate: number | null;
  revenueThisMonthCents: number;
};

export function HostListingRow({
  listing,
  stats,
}: {
  listing: {
    id: string;
    title: string;
    city: string;
    country: string;
    pricePerNightCents: number;
    published: boolean;
    photos: string[];
    bookings: {
      id: string;
      checkIn: Date;
      checkOut: Date;
      guests: number;
      totalPriceCents: number;
      serviceFeeCents: number;
      taxCents: number;
      creditAppliedCents: number;
      promoDiscountCents: number;
      approvalStatus: string;
      status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "REFUNDED";
      paymentStatus: "UNPAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";
      refundedAmountCents: number | null;
      changeRequests: ChangeRequestRow[];
    }[];
  };
  stats: HostListingStats;
}) {
  const [deleted, setDeleted] = useState(false);
  const [showAllBookings, setShowAllBookings] = useState(false);
  const upcomingCount = listing.bookings.filter(
    (b) => b.status === "PENDING" || b.status === "CONFIRMED",
  ).length;
  const visibleBookings = showAllBookings
    ? listing.bookings
    : listing.bookings.slice(0, INITIAL_VISIBLE_BOOKINGS);
  const hiddenCount = listing.bookings.length - visibleBookings.length;

  if (deleted) return null;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-4">
        <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
          {listing.photos[0] ? (
            <Image
              src={listing.photos[0]}
              alt={listing.title}
              fill
              className="object-cover"
              sizes="112px"
              unoptimized={!isOptimizableImage(listing.photos[0])}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-stone-400">
              <ImageOff className="h-5 w-5" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <Link
                href={`/listings/${listing.id}`}
                className="block line-clamp-2 font-medium text-foreground hover:text-brand-700"
              >
                {listing.title}
              </Link>
              <p className="text-sm text-stone-500">
                {listing.city}, {listing.country} · {formatPrice(listing.pricePerNightCents)}/night
              </p>
            </div>
            <div className="-ml-2 flex flex-wrap items-center gap-1 sm:ml-0 sm:shrink-0">
              <Link
                href={`/host/listings/${listing.id}/calendar`}
                className="focus-ring flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-stone-700 hover:bg-surface-muted"
              >
                <CalendarDays className="h-4 w-4" />
                Calendar
              </Link>
              <Link
                href={`/host/listings/${listing.id}/reviews`}
                className="focus-ring flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-stone-700 hover:bg-surface-muted"
              >
                <MessageSquare className="h-4 w-4" />
                Reviews
              </Link>
              <Link
                href={`/host/listings/${listing.id}/edit`}
                className="focus-ring flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-stone-700 hover:bg-surface-muted"
              >
                <PencilLine className="h-4 w-4" />
                Edit
              </Link>
              <DeleteListingButton
                listingId={listing.id}
                listingTitle={listing.title}
                onDeleted={() => setDeleted(true)}
                onDeleteFailed={() => setDeleted(false)}
              />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={listing.published ? "success" : "neutral"}>
              {listing.published ? "Published" : "Unpublished"}
            </Badge>
            <Badge variant="brand">
              {upcomingCount} upcoming booking{upcomingCount === 1 ? "" : "s"}
            </Badge>
            {stats.avgRating !== null && (
              <span className="inline-flex items-center gap-1 text-sm text-stone-600">
                <Star className="h-3.5 w-3.5 fill-accent-500 text-accent-500" />
                {stats.avgRating.toFixed(1)}
                <span className="text-stone-500">({stats.reviewCount})</span>
              </span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-surface-muted p-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-stone-500">Revenue this month</p>
              <p className="font-semibold text-foreground">{formatPrice(stats.revenueThisMonthCents)}</p>
            </div>
            <div>
              <p className="text-xs text-stone-500">Occupancy (next 30d)</p>
              <p className="font-semibold text-foreground">
                {stats.occupancyRate === null ? "—" : `${stats.occupancyRate}%`}
              </p>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className="text-xs text-stone-500">Rating</p>
              <p className="font-semibold text-foreground">
                {stats.avgRating === null ? "No reviews yet" : `${stats.avgRating.toFixed(1)} / 5`}
              </p>
            </div>
          </div>

          {listing.bookings.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-3 text-sm text-stone-600">
              {visibleBookings.map((booking) => {
                const approvedRequest = booking.changeRequests.find((cr) => cr.status === "APPROVED");
                const isCancelled = booking.status === "CANCELLED" || booking.status === "REFUNDED";
                return (
                  <li key={booking.id} className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        {formatStayDate(booking.checkIn)} –{" "}
                        {formatStayDate(booking.checkOut)} · {booking.guests} guest
                        {booking.guests > 1 ? "s" : ""}
                        {!isCancelled && (
                          <> · you earn {formatPrice(hostPayoutCents(booking))}</>
                        )}
                      </span>
                      <Badge variant={bookingStatusVariant[booking.status]}>{statusLabel(booking)}</Badge>
                      {approvedRequest && <Badge variant="warning">Modified</Badge>}
                    </div>

                    {approvedRequest && (
                      <p className="text-xs text-stone-500">
                        Originally {formatStayDate(approvedRequest.originalCheckIn)} –{" "}
                        {formatStayDate(approvedRequest.originalCheckOut)} ·{" "}
                        {approvedRequest.originalGuests} guest
                        {approvedRequest.originalGuests > 1 ? "s" : ""} ·{" "}
                        {formatPrice(approvedRequest.originalTotalPriceCents)} &rarr; now{" "}
                        {formatPrice(approvedRequest.originalTotalPriceCents + approvedRequest.priceDeltaCents)}
                      </p>
                    )}

                    {isCancelled && (
                      <p className="text-xs text-stone-500">
                        {paymentStatusLabel[booking.paymentStatus]}
                        {booking.refundedAmountCents
                          ? ` · ${formatPrice(booking.refundedAmountCents)} refunded to the guest`
                          : ""}
                        {` · you keep ${formatPrice(hostRevenueCents(booking))}`}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {hiddenCount > 0 && (
            <button
              onClick={() => setShowAllBookings(true)}
              className="focus-ring mt-2 text-sm font-medium text-brand-700 hover:underline"
            >
              Show {hiddenCount} more reservation{hiddenCount === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
