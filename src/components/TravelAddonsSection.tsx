"use client";

import { useFormattedPrice } from "@/components/CurrencyProvider";
import { trackAddonEvent } from "@/lib/analytics";
import { useViewOnce } from "@/hooks/useViewOnce";
import { PartnerServiceCard, ServiceBanner } from "@/components/LargeCard";
import { LargeCardRail } from "@/components/LargeCardRail";
import { partnerServiceForOffering } from "@/lib/partnerServices";
import { travelAddonHref, type TravelAddonOffering } from "@/lib/travelAddons";

/**
 * The homepage's travel add-ons (see the cross-sell brief in
 * docs/trip-extras-roadmap.md), one large card per category with a live
 * offering (see getActiveOfferings in src/lib/travelAddons.ts). The page
 * renders nothing here when no offering is live, so it never shows a card
 * with nothing behind it.
 */
export function TravelAddonsSection({ offerings }: { offerings: TravelAddonOffering[] }) {
  return (
    <LargeCardRail label="Travel">
      {offerings.map((offering) => (
        <TravelAddonCard key={offering.id} offering={offering} />
      ))}
    </LargeCardRail>
  );
}

/**
 * One travel add-on as a partner service card (see src/lib/partnerServices.ts):
 * the provider - EV Exec, for airport transfers - presented as the
 * independent business providing it, booked through FYStay's own
 * /travel-extras flow. "banner": the homepage's Services section, as one
 * wide photo banner (ServiceBanner).
 */
export function TravelAddonCard({ offering, variant = "card" }: { offering: TravelAddonOffering; variant?: "card" | "banner" }) {
  const price = useFormattedPrice(offering.priceCents);
  const viewRef = useViewOnce<HTMLDivElement>(() => {
    trackAddonEvent({
      name: "transfer_offer_viewed",
      category: offering.category,
      surface: "homepage",
      offeringId: offering.id,
    });
  });

  function handleCtaClick() {
    trackAddonEvent({
      name: "transfer_offer_clicked",
      category: offering.category,
      surface: "homepage",
      offeringId: offering.id,
    });
  }

  const service = {
    ...partnerServiceForOffering(offering, travelAddonHref(offering.category)),
    price: { label: price, detail: offering.name },
  };
  return (
    <div ref={viewRef}>
      {variant === "banner" ? (
        <ServiceBanner service={service} onClick={handleCtaClick} />
      ) : (
        <PartnerServiceCard service={service} onClick={handleCtaClick} />
      )}
    </div>
  );
}
