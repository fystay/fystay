"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Home } from "lucide-react";
import { BookingSummaryCard } from "@/components/BookingSummaryCard";
import { BookingSuccessMilestones } from "@/components/BookingSuccessMilestones";
import { AirportTransferNudge } from "@/components/AirportTransferNudge";
import { ConfettiBurst } from "@/components/ConfettiBurst";
import { SuccessCheckmark } from "@/components/SuccessCheckmark";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { LengthOfStayDiscountLabel } from "@/lib/pricing";

const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 12;

// One per poll tick, in order - purely to make an inherently-uncertain wait
// (this app has no way to know how many seconds Stripe itself will take)
// feel like it's actually progressing through real steps, rather than one
// static "please wait" the whole time. Loops if confirmation takes longer
// than the list.
const CONFIRMING_MESSAGES = [
  "Checking your dates…",
  "Securing your stay…",
  "Letting your host know…",
  "Almost there…",
];

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
  lengthOfStayDiscountCents,
  lengthOfStayDiscountLabel,
  cleaningFeeCents,
  serviceFeeCents,
  taxCents,
  creditAppliedCents,
  totalPriceCents,
  securityDepositCents,
  guestName,
  guestEmail,
  guestPhone,
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
  lengthOfStayDiscountCents: number;
  lengthOfStayDiscountLabel: LengthOfStayDiscountLabel | null;
  cleaningFeeCents: number;
  serviceFeeCents: number;
  taxCents: number;
  creditAppliedCents: number;
  totalPriceCents: number;
  securityDepositCents: number;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
}) {
  const [status, setStatus] = useState<BookingStatus>(initialStatus);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(initialPaymentStatus);
  const [pollsExhausted, setPollsExhausted] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  const pollCount = useRef(0);

  useEffect(() => {
    if (status !== "PENDING") return;

    const interval = setInterval(async () => {
      pollCount.current += 1;
      setMessageIndex((i) => (i + 1) % CONFIRMING_MESSAGES.length);
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
            <p className="font-medium text-foreground">Still confirming your payment</p>
            <p className="max-w-sm text-sm text-stone-500">
              This is taking longer than usual. You&apos;ll see your booking under &quot;My
              trips&quot; as soon as it&apos;s confirmed.
            </p>
            <Link href="/bookings" className={cn(buttonVariants(), "mt-2")}>
              Go to my trips
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
            <p
              key={messageIndex}
              className="animate-confirm-message-in font-medium text-foreground"
            >
              {CONFIRMING_MESSAGES[messageIndex]}
            </p>
            <p className="text-sm text-stone-500">This only takes a moment.</p>
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
            You&apos;re all set. A confirmation has been saved to your account under &quot;My
            trips&quot;.
          </p>
          <BookingSuccessMilestones checkIn={checkIn} />
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold text-foreground">Booking {status.toLowerCase()}</h1>
          <p className="max-w-sm text-sm text-stone-500">
            This reservation is no longer awaiting payment.
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
          lengthOfStayDiscountCents={lengthOfStayDiscountCents}
          lengthOfStayDiscountLabel={lengthOfStayDiscountLabel}
          cleaningFeeCents={cleaningFeeCents}
          serviceFeeCents={serviceFeeCents}
          taxCents={taxCents}
          creditAppliedCents={creditAppliedCents}
          securityDepositCents={securityDepositCents}
          totalPriceCents={totalPriceCents}
          reference={reference}
          guestName={guestName}
          guestEmail={guestEmail}
          guestPhone={guestPhone}
          paymentStatus={paymentStatus}
        />
      </div>

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
        <Link href="/bookings" className={cn(buttonVariants(), "w-full sm:w-auto")}>
          View my trips
        </Link>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto")}
        >
          Explore more stays
        </Link>
      </div>
    </div>
  );
}
