import { prisma } from "@/lib/prisma";
import { bookableHostWhere } from "@/lib/stripeConnect";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";

/**
 * A ?city= search counts as a picked place only for a town the search box
 * itself suggests: one with a FYStay destination page, or with live stays.
 * Anything else was typed, not picked.
 */
export async function isKnownTown(city: string): Promise<boolean> {
  const lower = city.toLowerCase();
  if (FYLDE_COAST_DESTINATIONS.some((town) => town.searchCity.toLowerCase() === lower)) return true;
  const count = await prisma.listing
    .count({ where: { published: true, suspendedAt: null, ...bookableHostWhere(), city: { equals: city, mode: "insensitive" } } })
    .catch(() => 0);
  return count > 0;
}
