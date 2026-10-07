import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/apiError";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronMonitor } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { ensureTownsSeeded } from "@/lib/localData/seedTowns";
import { getTownWeather } from "@/lib/localData/weather";
import { getTownPlaces } from "@/lib/localData/places";
import { getTownEvents } from "@/lib/localData/events";

// Cold Overpass/Ticketmaster fetches across five towns can take longer than
// a serverless function's 10-second default - safely within Vercel's Hobby
// (free-tier) ceiling of 60s, which the "keep this at £0" brief calls for
// staying inside rather than needing a Pro plan just to run this route.
export const maxDuration = 60;

type TownRefreshResult = {
  townSlug: string;
  weather: "ok" | "unavailable";
  places: number;
  events: number;
};

/**
 * The scheduled entry point for keeping Supabase's local-data tables warm -
 * see vercel.json for the schedule. Every source this calls
 * (getTownWeather/getTownPlaces/getTownEvents) already does its own
 * freshness check and graceful-failure handling internally, so this route
 * adds nothing beyond "call them for every real town": running it against
 * a town whose caches are still fresh is a cheap no-op, not a wasted
 * request, and nothing here is what makes the site work - every page
 * already self-heals on its own next request whether or not this route has
 * ever run. Its only job is making sure that self-heal happens during a
 * quiet scheduled window instead of on the next guest's page load.
 *
 * Towns are refreshed one at a time rather than all five in parallel, out
 * of respect for Overpass's fair-use request for infrequent, sequential
 * traffic - not because concurrent requests here would otherwise break
 * anything.
 */
async function getHandler(request: Request) {
  if (!isAuthorizedCronRequest(request, process.env.LOCAL_DATA_CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureTownsSeeded();
  const towns = await prisma.localTown.findMany({ select: { slug: true } });

  const results: TownRefreshResult[] = [];
  for (const town of towns) {
    const [weather, places, events] = await Promise.all([
      getTownWeather(town.slug),
      getTownPlaces(town.slug),
      getTownEvents(town.slug),
    ]);
    results.push({
      townSlug: town.slug,
      weather: weather ? "ok" : "unavailable",
      places: places.length,
      events: events.length,
    });
  }

  return NextResponse.json({ refreshedAt: new Date().toISOString(), towns: results });
}

export const GET = withCronMonitor("refresh-local-data", "0 5 * * *", "LOCAL_DATA_CRON_SECRET", withApiErrorHandling(getHandler));
