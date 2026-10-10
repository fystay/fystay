"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, Home, MessageCircle } from "lucide-react";
import { BookingSummaryCard } from "@/components/BookingSummaryCard";
import { BookingSuccessMilestones } from "@/components/BookingSuccessMilestones";
import { AirportTransferNudge } from "@/components/AirportTransferNudge";
import { ConfettiBurst } from "@/components/ConfettiBurst";
import { SuccessCheckmark } from "@/components/SuccessCheckmark";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import type { LengthOfStayDiscountLabel } from "@/lib/pricing";

const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 12;


type BookingStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "REFUNDED";
type PaymentStatus = "UNPAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";

export function BookingConfirmation({
  bookingId,
  airportTransfer,
  initialStatus,
  initialPaymentStatus,
  reference,
  listing,
  checkIn,
  checkOut,
  nights,
  guests,
  nightlyPriceCents,
  weekendNights = 0,
  weekendNightlyPriceCents = null,
  lengthOfStayDiscountCents,
  lengthOfStayDiscountLabel,
  cleaningFeeCents,
  serviceFeeCents,
  taxCents,
  creditAppliedCents,
  promoDiscountCents,
  totalPriceCents,
  securityDepositCents,
  guestName,
  guestEmail,
  guestPhone,
  hostName,
  cancellation,
  refundedAmountCents,
}: {
  bookingId: string;
  airportTransfer: {
    offeringId: string;
    providerName: string;
    priceCents: number;
    features: string[];
  } | null;
  initialStatus: BookingStatus;
  initialPaymentStatus: PaymentStatus;
  reference: string;
  listing: { title: string; city: string; country: string; photos: string[] };
  checkIn: Date;
  checkOut: Date;
  nights: number;
  guests: number;
  nightlyPriceCents: number;
  weekendNights?: number;
  weekendNightlyPriceCents?: number | null;
  lengthOfStayDiscountCents: number;
  lengthOfStayDiscountLabel: LengthOfStayDiscountLabel | null;
  cleaningFeeCents: number;
  serviceFeeCents: number;
  taxCents: number;
  creditAppliedCents: number;
  promoDiscountCents: number;
  totalPriceCents: number;
  securityDepositCents: number;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  hostName: string;
  /** Where this stay stands under its cancellation policy (see cancellationStanding). */
  cancellation: { line: string; policy: string };
  refundedAmountCents: number | null;
}) {
  const [status, setStatus] = useState<BookingStatus>(initialStatus);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(initialPaymentStatus);
  const [pollsExhausted, setPollsExhausted] = useState(false);
  const pollCount = useRef(0);

  useEffect(() => {
    if (status !== "PENDING") return;

    const interval = setInterval(async () => {
      pollCount.current += 1;
      try {
        const res = await fetch(`/api/bookings/${bookingId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.booking.status !== "PENDING") {
            setStatus(data.booking.status);
            setPaymentStatus(data.booking.paymentStatus);
            clearInterval(interval);
            return;
          }
        }
      } catch {
        // A transient network hiccup while polling isn't worth surfacing;
        // the next tick (or the max-polls fallback) will resolve it.
      }
      if (pollCount.current >= MAX_POLLS) {
        setPollsExhausted(true);
        clearInterval(interval);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [status, bookingId]);

  if (status === "PENDING") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        {pollsExhausted ? (
          <>
            <p className="font-medium text-foreground">We&apos;re still waiting for Stripe to confirm your payment</p>
            <p className="max-w-sm text-sm text-stone-500">
              This is taking longer than usual. Please don&apos;t pay again - you won&apos;t be
              charged twice. As soon as Stripe confirms it, your booking will show as confirmed
              and we&apos;ll email you.
            </p>
            <Link href={`/bookings/${bookingId}`} className={cn(buttonVariants(), "mt-2")}>
              View booking
            </Link>
          </>
        ) : (
          <>
            {/* A radar-style pulse rather than a plain spinner - the guest
                has no way to know how many seconds this actually takes, so
                the animation's job is to read as "working", not to imply a
                specific duration the way a determinate progress bar would. */}
            <div className="relative flex h-20 w-20 items-center justify-center">
              <span
                className="confirm-ping absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400/40"
                style={{ animationDuration: "1.8s" }}
              />
              <span
                className="confirm-ping absolute inline-flex h-14 w-14 animate-ping rounded-full bg-brand-400/40"
                style={{ animationDuration: "1.8s", animationDelay: "0.5s" }}
              />
              <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg">
                <Home className="h-6 w-6" />
              </span>
            </div>
            <p className="font-medium text-foreground">Confirming your payment…</p>
            <p className="text-sm text-stone-500">
              This usually takes a few seconds. Please keep this page open.
            </p>
            <div
              className="relative h-1.5 w-48 overflow-hidden rounded-full bg-brand-50"
              role="progressbar"
              aria-label="Confirming your payment"
            >
              <span className="confirm-bar-sweep" />
            </div>
          </>
        )}
      </div>
    );
  }

  const isConfirmed = status === "CONFIRMED" || status === "COMPLETED";

  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      {isConfirmed ? (
        <>
          <div className="relative flex h-20 w-20 items-center justify-center">
            <ConfettiBurst />
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
              <SuccessCheckmark size={44} />
            </div>
          </div>
          <h1 className="animate-confirm-message-in text-2xl font-bold text-foreground">
            Booking confirmed!
          </h1>
          <p className="animate-confirm-message-in max-w-sm text-sm text-stone-500">
            You&apos;re all set.
            {guestEmail ? (
              <>
                {" "}
                A confirmation email is on its way to <span className="font-medium text-stone-700">{guestEmail}</span>.
              </>
            ) : (
              " Your booking is saved under My trips."
            )}
          </p>
          <BookingSuccessMilestones checkIn={checkIn} />
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold text-foreground">We couldn&apos;t confirm this booking</h1>
          <p className="max-w-sm text-sm text-stone-500">
            {paymentStatus === "REFUNDED" || paymentStatus === "PARTIALLY_REFUNDED"
              ? `These dates were taken by another guest just before your payment went through, so we've refunded ${formatPrice(refundedAmountCents ?? totalPriceCents)} in full. Refunds usually take 5-10 working days to reach your card.`
              : "This reservation is no longer active and you haven't been charged."}
          </p>
        </>
      )}

      <div className="mt-6 w-full text-left">
        <BookingSummaryCard
          listing={listing}
          checkIn={checkIn}
          checkOut={checkOut}
          nights={nights}
          guests={guests}
          nightlyPriceCents={nightlyPriceCents}
          weekendNights={weekendNights}
          weekendNightlyPriceCents={weekendNightlyPriceCents}
          lengthOfStayDiscountCents={lengthOfStayDiscountCents}
          lengthOfStayDiscountLabel={lengthOfStayDiscountLabel}
          cleaningFeeCents={cleaningFeeCents}
          serviceFeeCents={serviceFeeCents}
          taxCents={taxCents}
          creditAppliedCents={creditAppliedCents}
          promoDiscountCents={promoDiscountCents}
          securityDepositCents={securityDepositCents}
          totalPriceCents={totalPriceCents}
          reference={reference}
          guestName={guestName}
          guestEmail={guestEmail}
          guestPhone={guestPhone}
          paymentStatus={paymentStatus}
        />
      </div>

      {isConfirmed && (
        <div className="mt-4 flex w-full flex-col gap-3 text-left text-sm sm:flex-row">
          <div className="flex flex-1 items-start gap-3 rounded-2xl border border-border-subtle bg-surface p-4">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
            <div>
              <p className="font-medium text-foreground">{cancellation.line}</p>
              <p className="mt-0.5 text-stone-500">{cancellation.policy}</p>
            </div>
          </div>
          <div className="flex flex-1 items-start gap-3 rounded-2xl border border-border-subtle bg-surface p-4">
            <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
            <div>
              <p className="font-medium text-foreground">Hosted by {hostName}</p>
              <p className="mt-0.5 text-stone-500">
                Check-in details, the address and a way to message {hostName} are on your booking page.
              </p>
            </div>
          </div>
        </div>
      )}

      {isConfirmed && airportTransfer && (
        <AirportTransferNudge
          bookingId={bookingId}
          offeringId={airportTransfer.offeringId}
          providerName={airportTransfer.providerName}
          priceCents={airportTransfer.priceCents}
          features={airportTransfer.features}
        />
      )}

      <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <Link href={`/bookings/${bookingId}`} className={cn(buttonVariants(), "w-full sm:w-auto")}>
          View booking
        </Link>
        <Link href="/bookings" className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto")}>
          All my trips
        </Link>
      </div>
    </div>
  );
}
