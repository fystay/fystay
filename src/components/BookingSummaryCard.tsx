import Image from "next/image";
import { CalendarClock, ImageOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { formatPrice } from "@/lib/format";
import { isOptimizableImage } from "@/lib/image";
import { stayDiscountName, type LengthOfStayDiscountLabel } from "@/lib/pricing";

const paymentStatusLabel: Record<string, string> = {
  UNPAID: "Unpaid",
  PAID: "Paid",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded",
};

const paymentStatusVariant: Record<string, BadgeProps["variant"]> = {
  UNPAID: "warning",
  PAID: "success",
  PARTIALLY_REFUNDED: "warning",
  REFUNDED: "neutral",
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function BookingSummaryCard({
  listing,
  checkIn,
  checkOut,
  nights,
  guests,
  nightlyPriceCents,
  lengthOfStayDiscountCents = 0,
  lengthOfStayDiscountLabel = null,
  cleaningFeeCents,
  serviceFeeCents,
  taxCents,
  creditAppliedCents = 0,
  promoDiscountCents = 0,
  totalPriceCents,
  securityDepositCents = 0,
  reference,
  guestName,
  guestEmail,
  guestPhone,
  paymentStatus,
  cancellationPolicyLabel,
  cancellationPolicyDescription,
}: {
  listing: { title: string; city: string; country: string; photos: string[] };
  checkIn: Date;
  checkOut: Date;
  nights: number;
  guests: number;
  nightlyPriceCents: number;
  lengthOfStayDiscountCents?: number;
  lengthOfStayDiscountLabel?: LengthOfStayDiscountLabel | null;
  cleaningFeeCents: number;
  serviceFeeCents: number;
  taxCents: number;
  /** Referral credit (see referral.ts) already subtracted into totalPriceCents - shown as its own line so the guest can see where it went, not folded silently into the total. */
  creditAppliedCents?: number;
  /** A promo code's discount, also already subtracted into totalPriceCents. */
  promoDiscountCents?: number;
  totalPriceCents: number;
  /** A refundable card hold, never part of totalPriceCents - authorized separately closer to check-in (see securityDeposit.ts) and never charged unless the host later files a damage claim. */
  securityDepositCents?: number;
  reference?: string;
  /** Only shown once there's a real reservation to review, i.e. on the confirmation page, not mid-checkout where the guest is still typing these into the form right next to this card. */
  guestName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  paymentStatus?: "UNPAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";
  /** Only passed at checkout, right before payment - once a booking exists,
   * its own page (via BookingCard) already shows the policy that actually
   * applied to it, so repeating it here would just be a second, easier-to-
   * drift-out-of-sync copy of the same fact. */
  cancellationPolicyLabel?: string;
  cancellationPolicyDescription?: string;
}) {
  const nightlySubtotalCents = nights * nightlyPriceCents;

  return (
    <Card className="p-5">
      <CardContent className="flex flex-col gap-4 p-0">
        {/* Photo above the text, full width: the card often sits in a narrow
            sidebar, where a photo alongside squeezed the title and town. */}
        <div className="flex flex-col gap-3">
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-surface-muted">
            {listing.photos[0] ? (
              <Image
                src={listing.photos[0]}
                alt={listing.title}
                fill
                className="object-cover"
                sizes="(min-width: 1024px) 400px, 100vw"
                unoptimized={!isOptimizableImage(listing.photos[0])}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-stone-400">
                <ImageOff className="h-5 w-5" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="line-clamp-2 font-semibold text-foreground">{listing.title}</p>
            {paymentStatus && (
              <Badge variant={paymentStatusVariant[paymentStatus]} className="mt-1">
                {paymentStatusLabel[paymentStatus]}
              </Badge>
            )}
            <p className="text-sm text-stone-500">
              {listing.city}, {listing.country}
            </p>
            {reference && (
              <p className="mt-1 text-xs font-medium text-stone-500">Booking #{reference}</p>
            )}
          </div>
        </div>

        {(guestName || guestEmail || guestPhone) && (
          <dl className="grid grid-cols-2 gap-y-1.5 border-t border-border-subtle pt-4 text-sm">
            <dt className="col-span-2 mb-0.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
              Guest details
            </dt>
            {guestName && (
              <>
                <dt className="text-stone-500">Name</dt>
                <dd className="text-right text-foreground">{guestName}</dd>
              </>
            )}
            {guestEmail && (
              <>
                <dt className="text-stone-500">Email</dt>
                <dd className="truncate text-right text-foreground">{guestEmail}</dd>
              </>
            )}
            {guestPhone && (
              <>
                <dt className="text-stone-500">Phone</dt>
                <dd className="text-right text-foreground">{guestPhone}</dd>
              </>
            )}
          </dl>
        )}

        <dl className="grid grid-cols-2 gap-y-1.5 border-t border-border-subtle pt-4 text-sm">
          <dt className="text-stone-500">Check-in</dt>
          <dd className="text-right text-foreground">{dateFormatter.format(checkIn)}</dd>
          <dt className="text-stone-500">Check-out</dt>
          <dd className="text-right text-foreground">{dateFormatter.format(checkOut)}</dd>
          <dt className="text-stone-500">Length of stay</dt>
          <dd className="text-right text-foreground">
            {nights} night{nights === 1 ? "" : "s"}
          </dd>
          <dt className="text-stone-500">Guests</dt>
          <dd className="text-right text-foreground">
            {guests} guest{guests === 1 ? "" : "s"}
          </dd>
        </dl>

        {cancellationPolicyLabel && (
          <div className="flex items-start gap-2 border-t border-border-subtle pt-4 text-sm text-stone-700">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            <p>
              <span className="font-medium text-foreground">
                {cancellationPolicyLabel} cancellation.
              </span>{" "}
              <span className="text-stone-500">{cancellationPolicyDescription}</span>
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-border-subtle pt-4 text-sm text-stone-700">
          <div className="flex justify-between">
            <span>
              {formatPrice(nightlyPriceCents)} × {nights} night{nights === 1 ? "" : "s"}
            </span>
            <span>{formatPrice(nightlySubtotalCents)}</span>
          </div>
          {lengthOfStayDiscountCents > 0 && (
            <div className="flex justify-between text-brand-700">
              <span>{stayDiscountName(lengthOfStayDiscountLabel)}</span>
              <span>&minus;{formatPrice(lengthOfStayDiscountCents)}</span>
            </div>
          )}
          {cleaningFeeCents > 0 && (
            <div className="flex justify-between">
              <span>Cleaning fee</span>
              <span>{formatPrice(cleaningFeeCents)}</span>
            </div>
          )}
          {serviceFeeCents > 0 && (
            <div className="flex justify-between">
              <span>Service fee</span>
              <span>{formatPrice(serviceFeeCents)}</span>
            </div>
          )}
          {taxCents > 0 && (
            <div className="flex justify-between">
              <span>Taxes</span>
              <span>{formatPrice(taxCents)}</span>
            </div>
          )}
          {promoDiscountCents > 0 && (
            <div className="flex justify-between text-brand-700">
              <span>Promo code</span>
              <span>&minus;{formatPrice(promoDiscountCents)}</span>
            </div>
          )}
          {creditAppliedCents > 0 && (
            <div className="flex justify-between text-brand-700">
              <span>Referral credit</span>
              <span>&minus;{formatPrice(creditAppliedCents)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border-subtle pt-3 text-base font-semibold text-foreground">
            <span>Total (GBP)</span>
            <span>{formatPrice(totalPriceCents)}</span>
          </div>
          {securityDepositCents > 0 && (
            <p className="text-xs text-stone-500">
              Plus a refundable {formatPrice(securityDepositCents)} security deposit hold,
              placed on your card the day before check-in - not charged now, not included in the
              total above, and released after your stay unless the host reports damage.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
