"use client";

import { formatPrice } from "@/lib/format";
import { MobileBookingBar, scrollToBookingWidget } from "@/components/MobileBookingBar";

/** A hotel listing's phone bar: its lowest room rate, and a way down to the rooms to choose from. */
export function HotelRoomsBar({ pricePerNightCents }: { pricePerNightCents: number }) {
  return (
    <MobileBookingBar
      amount={
        <>
          <span className="text-sm text-stone-500">From </span>
          <span className="font-bold text-brand-800">{formatPrice(pricePerNightCents)}</span>
          <span className="text-sm text-stone-500"> / night</span>
        </>
      }
      actionLabel="Choose a room"
      onAction={scrollToBookingWidget}
    />
  );
}
