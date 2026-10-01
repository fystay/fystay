import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LANDMARKS } from "@/lib/landmarks";
import { popularDestinations, rankDestinations, rankHotels, rankLandmarks } from "@/lib/searchSuggestions";

// Small, fixed limits keep this fast: the client debounces keystrokes and
// aborts stale requests, but the query itself should stay cheap regardless.
const MAX_RESULTS_PER_GROUP = 5;
// Landmarks are a small, fixed, curated list (see landmarks.ts) - a shorter
// cap than destinations/hotels keeps the dropdown from being dominated by
// them when a query happens to match several.
const MAX_LANDMARK_RESULTS = 4;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();

  try {
    const cityAggregates = await prisma.listing.groupBy({
      by: ["city", "country"],
      where: { published: true },
      _count: { _all: true },
    });
    const cities = cityAggregates.map((row) => ({
      city: row.city,
      country: row.country,
      count: row._count._all,
    }));

    if (!query) {
      return NextResponse.json({
        query: "",
        popular: true,
        destinations: popularDestinations(cities, { limit: MAX_RESULTS_PER_GROUP + 1 }),
        landmarks: [],
        hotels: [],
      });
    }

    const [destinations, matchingListings] = await Promise.all([
      Promise.resolve(rankDestinations(cities, query, MAX_RESULTS_PER_GROUP)),
      prisma.listing.findMany({
        where: { published: true, suspendedAt: null, title: { contains: query, mode: "insensitive" } },
        select: { id: true, title: true, city: true, country: true, photos: true },
        take: 20,
      }),
    ]);

    const landmarks = rankLandmarks(LANDMARKS, query, MAX_LANDMARK_RESULTS);
    const hotels = rankHotels(matchingListings, query, MAX_RESULTS_PER_GROUP);

    return NextResponse.json({ query, popular: false, destinations, landmarks, hotels });
  } catch {
    return NextResponse.json({ error: "Search is temporarily unavailable" }, { status: 503 });
  }
}
