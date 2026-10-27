import { EditorialHeader } from "@/components/EditorialHeader";
import * as Sentry from "@sentry/nextjs";
import { getActiveOfferings } from "@/lib/travelAddons";
import { TravelAddonCard } from "@/components/TravelAddonsSection";
import { ServiceBanner } from "@/components/LargeCard";
import { FYSTAY_SERVICES } from "@/lib/services";

// FYStay's own transfers page, for when no partner offer is live.
const AIRPORT_TRANSFERS = FYSTAY_SERVICES.find((service) => service.href === "/travel-extras")!;

/**
 * The homepage's Services: one wide photo banner for airport transfers - a
 * live partner's offer (EV Exec today, with its price) when there is one,
 * else FYStay's own transfers page. Few words; the photo sells it.
 */
export async function HomeServices() {
  // An optional extra: if offerings can't be read, FYStay's own banner shows.
  const offerings = await getActiveOfferings().catch((error: unknown) => {
    console.error("Couldn't load travel offerings", error);
    Sentry.captureException(error);
    return [];
  });
  const transferOffer = offerings.find((offering) => offering.category === "AIRPORT_TRANSFER") ?? offerings[0];

  return (
    <section className="mt-12 sm:mt-16" aria-labelledby="services-heading">
      <EditorialHeader
        id="services-heading"
        name="Services near you"
        tagline="Everything around your stay"
        link={{ href: "/services", label: "View all" }}
      />
      {transferOffer ? (
        <TravelAddonCard offering={transferOffer} variant="banner" />
      ) : (
        <ServiceBanner
          service={{
            category: AIRPORT_TRANSFERS.title,
            cta: AIRPORT_TRANSFERS.cta,
            href: AIRPORT_TRANSFERS.href,
            backdrop: AIRPORT_TRANSFERS.gradient,
          }}
        />
      )}
    </section>
  );
}
