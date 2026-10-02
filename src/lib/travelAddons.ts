import { prisma } from "@/lib/prisma";
import type { ExtraCategory } from "@prisma/client";

export type TravelAddonOffering = {
  id: string;
  name: string;
  description: string | null;
  category: ExtraCategory;
  priceCents: number;
  features: string[];
  providerName: string;
};

/**
 * The one query every cross-sell surface (homepage, property page, booking
 * flow, confirmation, account, /travel-extras) calls to find what to show
 * for a given add-on category - see docs/trip-extras-roadmap.md. Generic
 * over ExtraCategory on purpose (see item 7 of the cross-sell brief): EV
 * Exec is the only active AIRPORT_TRANSFER offering today, but a future
 * attraction/car-hire/restaurant surface reuses this exact function rather
 * than each surface writing its own Prisma query.
 *
 * `findFirst` ordered by createdAt is a deliberate MVP choice for "which
 * offering represents this category" while at most one is ever active per
 * category - picking a "featured" one among several is a later problem.
 */
export async function getActiveOfferingByCategory(
  category: ExtraCategory,
): Promise<TravelAddonOffering | null> {
  const offering = await prisma.extraOffering.findFirst({
    where: { category, active: true, provider: { active: true } },
    include: { provider: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!offering) return null;
  return {
    id: offering.id,
    name: offering.name,
    description: offering.description,
    category: offering.category,
    priceCents: offering.priceCents,
    features: offering.features,
    providerName: offering.provider.name,
  };
}

/** Plain-language label per category - shared so every surface's copy agrees. */
export const ADDON_CATEGORY_LABELS: Record<ExtraCategory, string> = {
  AIRPORT_TRANSFER: "Airport transfer",
  ATTRACTION_TICKET: "Attraction ticket",
  CAR_HIRE: "Car hire",
};

/**
 * Category order for the "browse and discover" surfaces - airport transfer
 * first since it's FYStay's own real, launched cross-sell, then the other
 * two categories in the order they were added. The property page's
 * PropertyTransferPromo shows one offering at a time by design, so for it
 * this is "which one" (getFeaturedOffering); the homepage's large-card
 * Travel rail shows every live one in this order (getActiveOfferings).
 */
const FEATURED_CATEGORY_PRIORITY: ExtraCategory[] = [
  "AIRPORT_TRANSFER",
  "ATTRACTION_TICKET",
  "CAR_HIRE",
];

/**
 * The one offering a single-slot cross-sell surface should feature - the
 * first category (in FEATURED_CATEGORY_PRIORITY order) that actually has an
 * active offering. Generic on purpose (see this file's own top comment):
 * callers used to hardcode getActiveOfferingByCategory("AIRPORT_TRANSFER")
 * directly, which meant a real attraction/car-hire offering could never
 * surface on the homepage or property page even once one existed.
 */
export async function getFeaturedOffering(): Promise<TravelAddonOffering | null> {
  for (const category of FEATURED_CATEGORY_PRIORITY) {
    const offering = await getActiveOfferingByCategory(category);
    if (offering) return offering;
  }
  return null;
}

/** Every category's live offering, in FEATURED_CATEGORY_PRIORITY order - categories with none are left out. */
export async function getActiveOfferings(): Promise<TravelAddonOffering[]> {
  const offerings = await Promise.all(FEATURED_CATEGORY_PRIORITY.map(getActiveOfferingByCategory));
  return offerings.filter((offering) => offering !== null);
}

/**
 * Optional trip context a cross-sell surface can pass through to the
 * /travel-extras landing page for display only (see TravelAddonLanding) -
 * never used to change eligibility or take a booking on that page itself
 * (see tripExtraPurchaseError in src/lib/tripExtras.ts, which still gates
 * on an existing FYStay Booking regardless). Every field is optional and
 * left out entirely when unknown - callers must never invent a value (an
 * airport, in particular, has no mapping anywhere in this codebase today)
 * just to fill this in.
 */
export type TravelAddonContext = {
  destination?: string | null;
  hotelName?: string | null;
  /** yyyy-mm-dd, matching formatDateParam in src/lib/hotelSearchParams.ts. */
  checkIn?: string | null;
  checkOut?: string | null;
  adults?: number | null;
  children?: number | null;
  airport?: string | null;
};

/** Every cross-sell CTA across the site links here - one generic landing page per category, not a bespoke page per add-on. `context` is appended as extra, purely-informational query params when known (see TravelAddonContext above). */
export function travelAddonHref(category: ExtraCategory, context?: TravelAddonContext): string {
  const params = new URLSearchParams({ category });
  if (context?.destination) params.set("destination", context.destination);
  if (context?.hotelName) params.set("hotel", context.hotelName);
  if (context?.checkIn) params.set("checkIn", context.checkIn);
  if (context?.checkOut) params.set("checkOut", context.checkOut);
  if (context?.adults != null) params.set("adults", String(context.adults));
  if (context?.children != null) params.set("children", String(context.children));
  if (context?.airport) params.set("airport", context.airport);
  return `/travel-extras?${params.toString()}`;
}

/** yyyy-mm-dd -> "15 Oct" for display; falls back to the raw value if it doesn't parse rather than showing "Invalid Date". */
export function formatTravelAddonContextDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

/**
 * One line acknowledging the trip a guest was just looking at elsewhere
 * (e.g. a hotel affiliate deal) before landing on /travel-extras - display
 * only, see TravelAddonContext's own comment for why nothing here ever
 * affects eligibility or which CTA TravelAddonLanding shows. Returns null
 * when the context carries nothing worth summarizing (every field absent),
 * so a caller can render nothing rather than an empty line.
 */
export function travelAddonContextSummary(context: TravelAddonContext): string | null {
  const parts: string[] = [];
  if (context.destination) {
    // Hotel display names in this app already fold their town into the name
    // itself (e.g. "The Grand Lodge, Blackpool") - appending the destination
    // again unconditionally would read as "The Grand Lodge, Blackpool,
    // Blackpool". Only append it when the hotel name doesn't already say it.
    const hotelAlreadyNamesDestination = Boolean(
      context.hotelName?.toLowerCase().includes(context.destination.toLowerCase()),
    );
    if (context.hotelName) {
      parts.push(hotelAlreadyNamesDestination ? context.hotelName : `${context.hotelName}, ${context.destination}`);
    } else {
      parts.push(context.destination);
    }
  }
  if (context.checkIn && context.checkOut) {
    parts.push(
      `${formatTravelAddonContextDate(context.checkIn)} – ${formatTravelAddonContextDate(context.checkOut)}`,
    );
  }
  const guests = (context.adults ?? 0) + (context.children ?? 0);
  if (guests > 0) parts.push(`${guests} guest${guests === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
