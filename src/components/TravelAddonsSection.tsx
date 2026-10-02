"use client";

import { CarFront, KeyRound, Ticket as TicketIcon, type LucideIcon } from "lucide-react";
import { trackAddonEvent } from "@/lib/analytics";
import { useViewOnce } from "@/hooks/useViewOnce";
import { LargeCard } from "@/components/LargeCard";
import { LargeCardRail } from "@/components/LargeCardRail";
import { ADDON_CATEGORY_LABELS, travelAddonHref, type TravelAddonOffering } from "@/lib/travelAddons";
import type { ExtraCategory } from "@prisma/client";

const CATEGORY_COPY: Record<
  ExtraCategory,
  { icon: LucideIcon; heading: (providerName: string) => string; blurb: string; cta: string }
> = {
  AIRPORT_TRANSFER: {
    icon: CarFront,
    heading: (providerName) => `Premium electric airport transfers with ${providerName}.`,
    blurb: "Travel door-to-door in comfort with a Tesla.",
    cta: "Add an airport transfer",
  },
  ATTRACTION_TICKET: {
    icon: TicketIcon,
    heading: (providerName) => `Skip the queue with ${providerName}.`,
    blurb: "Book a local attraction ticket alongside your stay.",
    cta: "Browse attraction tickets",
  },
  CAR_HIRE: {
    icon: KeyRound,
    heading: (providerName) => `Need wheels? ${providerName} has you covered.`,
    blurb: "Hire a car for the length of your stay.",
    cta: "Browse car hire",
  },
};

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

function TravelAddonCard({ offering }: { offering: TravelAddonOffering }) {
  const copy = CATEGORY_COPY[offering.category];
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

  return (
    <div ref={viewRef}>
      <LargeCard
        href={travelAddonHref(offering.category)}
        onClick={handleCtaClick}
        image={{ icon: copy.icon, gradient: "from-brand-700 via-brand-900 to-ink" }}
        eyebrow={ADDON_CATEGORY_LABELS[offering.category]}
        title={copy.heading(offering.providerName)}
        description={copy.blurb}
        meta={copy.cta}
      />
    </div>
  );
}
