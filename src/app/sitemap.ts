import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";
import { SITE_URL } from "@/lib/seo";

// Rendered per-request rather than prerendered at build time: a build
// machine isn't guaranteed the same database access as the deployed
// serverless functions, so a build-time query here would make the whole
// site's build fragile on something unrelated to the actual code.
export const dynamic = "force-dynamic";

// Static, always-indexable pages beyond the homepage and listings - kept as
// a plain list here rather than trying to auto-discover routes, since a
// route being renderable doesn't mean it should be indexed (e.g. /search,
// deliberately noindexed via its own metadata since every filter
// combination renders from the same URL shape as the homepage).
const STATIC_PAGES = [
  "/about",
  "/contact",
  "/host",
  "/help",
  "/safety",
  "/host-guide",
  "/cancellation-policies",
  "/legal/terms",
  "/legal/privacy",
  "/legal/cookies",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // A sitemap is non-critical: if the database is briefly unreachable,
  // degrade to just the homepage and static pages rather than failing the
  // request.
  const listings = await prisma.listing
    .findMany({
      where: { published: true, suspendedAt: null },
      select: { id: true, updatedAt: true },
    })
    .catch(() => []);

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    ...STATIC_PAGES.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.3,
    })),
    ...FYLDE_COAST_DESTINATIONS.map((destination) => ({
      url: `${SITE_URL}/destinations/${destination.slug}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...listings.map((listing) => ({
      url: `${SITE_URL}/listings/${listing.id}`,
      lastModified: listing.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
