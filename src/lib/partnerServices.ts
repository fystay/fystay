import type { ExtraCategory } from "@prisma/client";
import type { TravelAddonOffering } from "@/lib/travelAddons";

/**
 * Services FYStay offers through independent providers - FYStay is the
 * platform that surfaces and books them; the provider (EV Exec for airport
 * transfers, the first) runs the service and stays identifiable as the one
 * providing it. Shaped generically so a new kind of partner (luggage
 * storage, car hire, tours, restaurants...) is a new entry here, not a new
 * component: LargeCard renders any PartnerService the same way.
 */
export type PartnerService = {
  /** The independent business providing the service - shown as its identity on the card. */
  provider: string;
  /** e.g. "Airport transfers". */
  category: string;
  title: string;
  description: string;
  /** How the card states the relationship, e.g. "FYStay service partner". */
  providerLabel: string;
  /** e.g. "Book with EV Exec". */
  cta: string;
  href: string;
  /** The provider's own official assets, used only when supplied (see PROVIDER_ASSETS). */
  logoSrc?: string;
  /** `position` is the CSS object-position that keeps the subject in frame at every crop. */
  image?: { src: string; alt: string; position?: string };
  /** Background for the card's image area until the provider's own image is supplied. */
  backdrop: string;
};

export const PARTNER_LABEL = "FYStay service partner";

/**
 * Official artwork supplied by each provider, by provider name, kept under
 * public/images/partners/<provider>/. Used exactly as supplied - FYStay
 * never draws, recolours or invents a provider's logo, or stands a generic
 * photo in for theirs. (EV Exec's logo file is its supplied artwork with
 * only the empty background margin trimmed.)
 */
const PROVIDER_ASSETS: Partial<
  Record<string, { logoSrc?: string; image?: { src: string; alt: string; position?: string } }>
> = {
  "EV Exec": {
    logoSrc: "/images/partners/ev-exec/logo.jpg",
    image: {
      src: "/images/partners/ev-exec/model-y-airport.jpg",
      alt: "A navy EV Exec Tesla Model Y outside an airport terminal at night",
      position: "45% 62%",
    },
  },
};

// What FYStay says about each kind of partner service. The provider's name
// comes from its own record (src/lib/travelAddons.ts), never this copy.
const CATEGORY_PRESENTATION: Record<
  ExtraCategory,
  { category: string; title: string; description: string; backdrop: string }
> = {
  AIRPORT_TRANSFER: {
    category: "Airport transfers",
    title: "Premium electric airport transfers",
    description: "Travel door-to-door in a Tesla, with your journey arranged around your FYStay.",
    backdrop: "from-[#1d2c46] via-[#121c30] to-[#080d18]",
  },
  ATTRACTION_TICKET: {
    category: "Attraction tickets",
    title: "Skip the queue at local attractions",
    description: "Book a local attraction ticket alongside your stay.",
    backdrop: "from-brand-700 via-brand-900 to-ink",
  },
  CAR_HIRE: {
    category: "Car hire",
    title: "Hire a car for your stay",
    description: "A car for the length of your stay, ready when you arrive.",
    backdrop: "from-brand-700 via-brand-900 to-ink",
  },
};

/** How a live travel add-on offering is presented as a partner service. */
export function partnerServiceForOffering(offering: TravelAddonOffering, href: string): PartnerService {
  const presentation = CATEGORY_PRESENTATION[offering.category];
  return {
    provider: offering.providerName,
    ...presentation,
    providerLabel: PARTNER_LABEL,
    cta: `Book with ${offering.providerName}`,
    href,
    ...PROVIDER_ASSETS[offering.providerName],
  };
}
