import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { syncListingIcalImport } from "@/lib/icalSync";
import { withApiErrorHandling } from "@/lib/apiError";

/** Host-triggered "Sync now" for a listing's configured icalImportUrl - see the nightly cron sweep in /api/cron/sync-ical-imports for the background counterpart. */
async function postHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  if (listing.hostId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!listing.icalImportUrl) {
    return NextResponse.json({ error: "No calendar import URL is set for this listing" }, { status: 400 });
  }

  try {
    const result = await syncListingIcalImport(prisma, id);
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json(
      { error: "Could not fetch that calendar - check the URL and try again" },
      { status: 502 },
    );
  }
}

export const POST = withApiErrorHandling(postHandler);
