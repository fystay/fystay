import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateIcs, type IcsEvent } from "@/lib/ical";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * A listing's calendar as a public .ics feed, for a host to subscribe to
 * from Airbnb/Vrbo/Google Calendar - the same direction as icalImportUrl,
 * but outbound. Authorized by icalExportToken in the query string rather
 * than a session, since calendar apps fetch feeds unauthenticated and
 * can't send a login cookie. Only CONFIRMED bookings and HOST-set blocks
 * are exported - never PENDING bookings (might still fall through before
 * payment) or ICAL_IMPORT blocks (re-exporting an imported event back out
 * would loop between two synced calendars).
 */
async function getHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      icalExportToken: true,
      bookings: {
        where: { status: "CONFIRMED" },
        select: { id: true, checkIn: true, checkOut: true },
      },
      availabilityBlocks: {
        where: { source: "HOST" },
        select: { id: true, startDate: true, endDate: true, reason: true },
      },
    },
  });

  if (!listing || !tokensMatch(listing.icalExportToken, token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const events: IcsEvent[] = [
    ...listing.bookings.map((b) => ({
      uid: `fystay-booking-${b.id}@fystay.dev`,
      start: b.checkIn,
      end: b.checkOut,
      summary: "Booked (FYStay)",
    })),
    ...listing.availabilityBlocks.map((b) => ({
      uid: `fystay-block-${b.id}@fystay.dev`,
      start: b.startDate,
      end: b.endDate,
      summary: b.reason ? `Blocked: ${b.reason}` : "Blocked (FYStay)",
    })),
  ];

  const ics = generateIcs({ calendarName: `${listing.title} - FYStay`, events });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline; filename=\"calendar.ics\"",
      // A hint for calendar apps that poll rather than push - not
      // authoritative, but costs nothing to include.
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export const GET = withApiErrorHandling(getHandler);

/** Constant-time, so the feed token can't be guessed a character at a time from response timing. */
function tokensMatch(expected: string, given: string | null): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
