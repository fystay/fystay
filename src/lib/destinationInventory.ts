import "server-only";
import { prisma } from "@/lib/prisma";
import { bookableHostWhere } from "@/lib/stripeConnect";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";

/**
 * Towns with live, bookable stays that don't have their own destination
 * page yet (a single lodge near Carnforth, say), read from real listings -
 * the same published / not suspended / payable-host rule search uses - so
 * nothing ever names a place where a guest can't actually book. Copy that
 * isn't backed by this stays to the Fylde Coast towns with their own pages
 * (docs/brand/fystay-brand.md). Empty when the database can't be read.
 */
export async function townsBeyondTheFyldeCoast(): Promise<{ city: string; count: number }[]> {
  const coveredCities = FYLDE_COAST_DESTINATIONS.map((destination) => destination.searchCity);
  const groups = await prisma.listing
    .groupBy({
      by: ["city"],
      where: { published: true, suspendedAt: null, ...bookableHostWhere(), city: { notIn: coveredCities } },
      _count: { _all: true },
      orderBy: { city: "asc" },
    })
    .catch(() => []);
  return groups.map((group) => ({ city: group.city, count: group._count._all }));
}
