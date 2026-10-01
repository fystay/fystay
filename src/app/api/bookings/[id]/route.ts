import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { PRIVATE_LISTING_FIELDS } from "@/lib/listingPrivacy";

/** Used by the checkout and confirmation pages to poll a single booking's live status. */
async function getHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    // Arrival details reach the guest on the booking page once it's paid;
    // this status poll never needs them.
    include: { listing: { omit: PRIVATE_LISTING_FIELDS } },
  });

  if (!booking || booking.guestId !== session.user.id) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  return NextResponse.json({ booking });
}

export const GET = withApiErrorHandling(getHandler);
