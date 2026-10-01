"use client";

import { useState } from "react";
import Link from "next/link";
import { BellRing } from "lucide-react";
import { formatPrice, formatStayDate } from "@/lib/format";
import { ChangeRequestActions } from "@/components/ChangeRequestActions";
import { BookingRequestActions } from "@/components/BookingRequestActions";
import { Card } from "@/components/ui/Card";

export type PendingChangeRequest = {
  kind: "change";
  id: string;
  bookingId: string;
  listingId: string;
  listingTitle: string;
  requestedCheckIn: Date;
  requestedCheckOut: Date;
  requestedGuests: number;
  priceDeltaCents: number;
};

export type PendingBookingRequest = {
  kind: "booking";
  id: string;
  listingId: string;
  listingTitle: string;
  guestName: string | null;
  checkIn: Date;
  checkOut: Date;
  guests: number;
  totalPriceCents: number;
};

export type AttentionItem = PendingChangeRequest | PendingBookingRequest;

/**
 * Everything a host needs to act on across every listing, in one place -
 * the host-side equivalent of a booking inbox, instead of making a host
 * hunt through each listing's own booking history to notice something
 * needs a reply. Covers two unrelated things a host has to decide on
 * (a guest-requested change to an existing booking, and a request-to-book
 * request for a new one - see Listing.instantBook), kept in one list since
 * both are "approve or decline, and soon" from the host's point of view.
 */
export function NeedsAttention({ requests }: { requests: AttentionItem[] }) {
  const [handledIds, setHandledIds] = useState<Set<string>>(new Set());
  const visible = requests.filter((r) => !handledIds.has(r.id));

  if (visible.length === 0) return null;

  function markHandled(id: string) {
    setHandledIds((prev) => new Set(prev).add(id));
  }
  function unmarkHandled(id: string) {
    setHandledIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  return (
    <div className="mt-8">
      <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
        <BellRing className="h-4.5 w-4.5 text-amber-500" />
        Needs your attention
      </h2>
      <div className="mt-3 flex flex-col gap-3">
        {visible.map((request) =>
          request.kind === "change" ? (
            <Card
              key={request.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium text-foreground">Guest requested a change</p>
                <p className="text-sm text-stone-600">
                  <Link href={`/listings/${request.listingId}`} className="hover:text-brand-700">
                    {request.listingTitle}
                  </Link>{" "}
                  · New dates: {formatStayDate(request.requestedCheckIn)} –{" "}
                  {formatStayDate(request.requestedCheckOut)} · {request.requestedGuests} guest
                  {request.requestedGuests > 1 ? "s" : ""}
                </p>
                {request.priceDeltaCents !== 0 && (
                  <p className="text-sm text-stone-600">
                    {request.priceDeltaCents > 0
                      ? `Guest will owe an extra ${formatPrice(request.priceDeltaCents)}`
                      : `Guest will be refunded ${formatPrice(Math.abs(request.priceDeltaCents))}`}
                  </p>
                )}
              </div>
              <ChangeRequestActions
                bookingId={request.bookingId}
                requestId={request.id}
                onOptimisticStart={() => markHandled(request.id)}
                onError={() => unmarkHandled(request.id)}
              />
            </Card>
          ) : (
            <Card
              key={request.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium text-foreground">
                  {request.guestName ?? "A guest"} requested to book
                </p>
                <p className="text-sm text-stone-600">
                  <Link href={`/listings/${request.listingId}`} className="hover:text-brand-700">
                    {request.listingTitle}
                  </Link>{" "}
                  · {formatStayDate(request.checkIn)} – {formatStayDate(request.checkOut)}{" "}
                  · {request.guests} guest{request.guests > 1 ? "s" : ""}
                </p>
                <p className="text-sm text-stone-600">Total: {formatPrice(request.totalPriceCents)}</p>
              </div>
              <BookingRequestActions
                bookingId={request.id}
                onOptimisticStart={() => markHandled(request.id)}
                onError={() => unmarkHandled(request.id)}
              />
            </Card>
          ),
        )}
      </div>
    </div>
  );
}
