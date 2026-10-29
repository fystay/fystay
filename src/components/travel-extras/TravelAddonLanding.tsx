"use client";

import Link from "next/link";
import { CarFront, Check, KeyRound, Ticket as TicketIcon, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { trackAddonEvent } from "@/lib/analytics";
import { useViewOnce } from "@/hooks/useViewOnce";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import { StandaloneTransferForm } from "@/components/travel-extras/StandaloneTransferForm";
import { PARTNER_LABEL } from "@/lib/partnerServices";
import { travelAddonContextSummary, type TravelAddonContext, type TravelAddonOffering } from "@/lib/travelAddons";

const CATEGORY_ICONS: Record<TravelAddonOffering["category"], LucideIcon> = {
  AIRPORT_TRANSFER: CarFront,
  ATTRACTION_TICKET: TicketIcon,
  CAR_HIRE: KeyRound,
};

/**
 * The generic landing page every cross-sell CTA across the site links to
 * (see travelAddons.travelAddonHref) - one component reused for whichever
 * ExtraCategory is passed in, not a bespoke page per add-on (see item 7 of
 * the cross-sell brief). Buying a Trip Extra normally requires an existing
 * confirmed stay (see tripExtraPurchaseError in src/lib/tripExtras.ts), so
 * the next step is either straight to that stay's own "Complete your trip"
 * card or to find a stay first. The exception is the airport transfer,
 * which has its own form here (StandaloneTransferForm) and can be bought
 * with no stay at all.
 */
export function TravelAddonLanding({
  offering,
  eligibleBookingId,
  tripContext,
  signedIn = false,
  defaultName = "",
  defaultPhone = "",
}: {
  offering: TravelAddonOffering;
  eligibleBookingId: string | null;
  tripContext?: TravelAddonContext | null;
  signedIn?: boolean;
  defaultName?: string;
  defaultPhone?: string;
}) {
  // An airport transfer can be booked on its own; the other add-ons still
  // need a stay (see tripExtraPurchaseError).
  const standalone = offering.category === "AIRPORT_TRANSFER";
  const Icon = CATEGORY_ICONS[offering.category];
  const contextSummary = tripContext ? travelAddonContextSummary(tripContext) : null;
  const viewRef = useViewOnce<HTMLDivElement>(() => {
    trackAddonEvent({
      name: "transfer_offer_viewed",
      category: offering.category,
      surface: "travel_extras_landing",
      offeringId: offering.id,
    });
  });

  function handleCtaClick() {
    trackAddonEvent({
      name: "transfer_offer_clicked",
      category: offering.category,
      surface: "travel_extras_landing",
      offeringId: offering.id,
      metadata: { hasEligibleBooking: Boolean(eligibleBookingId) },
    });
  }

  return (
    <div ref={viewRef} className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{offering.name}</h1>
          <p className="text-sm text-stone-500">
            Provided by {offering.providerName} · {PARTNER_LABEL}
          </p>
        </div>
      </div>

      {contextSummary && (
        <p className="mt-4 inline-flex max-w-lg rounded-lg bg-surface-muted px-3 py-2 text-xs font-medium text-stone-600">
          For your trip: {contextSummary}
        </p>
      )}

      {offering.description && (
        <p className="mt-4 max-w-lg text-sm text-stone-600">{offering.description}</p>
      )}

      <Card className="mt-6">
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Price</p>
            <p className="text-2xl font-bold text-foreground">{formatPrice(offering.priceCents)}</p>
          </div>

          {offering.features.length > 0 && (
            <ul className="flex flex-col gap-2">
              {offering.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-sm text-stone-600">
                  <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  {feature}
                </li>
              ))}
            </ul>
          )}

          {standalone ? (
            <>
              <div className="mt-2 border-t border-border-subtle pt-5">
                <h2 className="mb-4 text-lg font-semibold text-foreground">Book your transfer</h2>
                <StandaloneTransferForm
                  offering={{
                    id: offering.id,
                    name: offering.name,
                    priceCents: offering.priceCents,
                    providerName: offering.providerName,
                  }}
                  signedIn={signedIn}
                  defaultName={defaultName}
                  defaultPhone={defaultPhone}
                />
              </div>
              {eligibleBookingId && (
                <p className="text-center text-xs text-stone-500">
                  Staying with FYStay?{" "}
                  <Link
                    href={`/bookings/${eligibleBookingId}#trip-extras`}
                    onClick={handleCtaClick}
                    className="font-medium text-brand-700 underline underline-offset-2"
                  >
                    Add it to your upcoming stay instead
                  </Link>
                  .
                </p>
              )}
            </>
          ) : (
            <>
              <Link
                href={eligibleBookingId ? `/bookings/${eligibleBookingId}#trip-extras` : "/search"}
                onClick={handleCtaClick}
                className={cn(buttonVariants({ size: "lg" }), "mt-2 justify-center")}
              >
                {eligibleBookingId ? "Add to my upcoming stay" : "Choose a stay to add this to"}
              </Link>
              <p className="text-center text-xs text-stone-500">
                {eligibleBookingId
                  ? "Booked and paid for alongside your stay, on your booking page."
                  : "This is added to a FYStay booking, so choose your stay first - then add it from your booking page."}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* What actually happens, step by step - so it never feels like being
          sent off to another company's website to start again. */}
      <section aria-labelledby="how-it-works" className="mt-8">
        <h2 id="how-it-works" className="text-lg font-semibold text-foreground">
          How it works
        </h2>
        <ol className="mt-3 flex flex-col gap-3">
          {(standalone
            ? [
                "Tell us where and when you need picking up.",
                "Pay by card with your FYStay account - no stay needed and no separate sign-up.",
                `${offering.providerName} gets your booking straight away and contacts you directly to confirm the details. It shows in My trips too.`,
              ]
            : [
                eligibleBookingId
                  ? "Open your upcoming FYStay booking."
                  : "Book your stay on FYStay - you'll need a confirmed booking first.",
                `Add the ${offering.name.toLowerCase()} from your booking page and pay with your FYStay account - no separate sign-up.`,
                `${offering.providerName} gets your booking straight away and contacts you directly to confirm the details. It shows on your FYStay booking too.`,
              ]
          ).map((step, i) => (
            <li key={step} className="flex gap-3 text-sm text-stone-600">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
