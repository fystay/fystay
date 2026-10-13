import Link from "next/link";
import { ArrowRight, Car, Compass, LifeBuoy, Landmark, type LucideIcon } from "lucide-react";
import { EditorialHeader } from "@/components/EditorialHeader";
import { cn } from "@/lib/cn";
import * as Sentry from "@sentry/nextjs";
import { getActiveOfferings } from "@/lib/travelAddons";
import { TravelAddonCard } from "@/components/TravelAddonsSection";

type ServiceCard = { icon: LucideIcon; title: string; description: string; href: string; cta: string };

// Only what FYStay actually offers today, each to a working page: airport
// transfers (added to a confirmed booking - see /travel-extras), the towns'
// Local Guides (attractions; things to do) and the help centre.
const AIRPORT_TRANSFERS: ServiceCard = {
  icon: Car,
  title: "Airport transfers",
  description: "Transport to and from your stay, added to a confirmed booking and paid for with it.",
  href: "/travel-extras",
  cta: "See transfers",
};

const SERVICES: ServiceCard[] = [
  {
    icon: Landmark,
    title: "Local attractions",
    description: "The sights in each town, in its Local Guide.",
    href: "/destinations",
    cta: "Discover",
  },
  {
    icon: Compass,
    title: "Things to do",
    description: "Family days out, beaches, walks and what's on.",
    href: "/destinations/blackpool#quick-discovery",
    cta: "Find things to do",
  },
  {
    icon: LifeBuoy,
    title: "Guest essentials",
    description: "Help before and during your stay, from the FYStay team.",
    href: "/help",
    cta: "Get help",
  },
];

/**
 * The homepage's Services: airport transfers first and largest - a live
 * partner's offer (EV Exec today, with its price) when there is one, else
 * FYStay's own transfers card - then three practical services.
 */
export async function HomeServices() {
  // An optional extra: if offerings can't be read, FYStay's own card shows.
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
        eyebrow="Services"
        title="Everything around your stay"
        link={{ href: "/services", label: "View all" }}
      />
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-4">
        {transferOffer ? (
          <div className="lg:row-span-1">
            <TravelAddonCard offering={transferOffer} />
          </div>
        ) : (
          <ServiceLink service={AIRPORT_TRANSFERS} featured />
        )}
        {SERVICES.map((service) => (
          <ServiceLink key={service.title} service={service} />
        ))}
      </div>
    </section>
  );
}

function ServiceLink({ service, featured = false }: { service: ServiceCard; featured?: boolean }) {
  const { icon: Icon, title, description, href, cta } = service;
  return (
    <Link
      href={href}
      className={cn(
        "focus-ring group flex rounded-2xl p-4 transition-shadow sm:p-5 hover:shadow-[var(--shadow-card-hover)]",
        featured
          ? "relative min-h-[150px] flex-col justify-end overflow-hidden bg-gradient-to-br from-brand-600 via-brand-800 to-ink text-white shadow-[var(--shadow-card)] lg:min-h-0"
          : "items-start gap-4 border border-border-subtle bg-surface lg:flex-col lg:gap-0",
      )}
    >
      {featured ? (
        <Icon className="absolute -right-4 -top-4 h-32 w-32 text-white/10" aria-hidden />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      )}
      <div className={cn("relative min-w-0", !featured && "lg:mt-4")}>
        {featured && <Icon className="mb-3 h-6 w-6" aria-hidden />}
        <h3 className={cn("font-serif text-lg font-bold leading-tight", featured ? "text-white" : "text-foreground")}>{title}</h3>
        <p className={cn("mt-1 text-sm leading-relaxed", featured ? "text-white/85" : "text-stone-500")}>{description}</p>
        <span
          className={cn(
            "mt-2 inline-flex items-center gap-1 text-sm font-medium",
            featured ? "text-white" : "text-brand-700 group-hover:text-brand-800",
          )}
        >
          {cta}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
