import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getBookingDetailForAdmin } from "@/lib/adminBookingLookup";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * Full support view of one booking - everything the guest-facing
 * /bookings/[id] page shows plus what support specifically needs
 * (Stripe payment intent id, disputes, extras, change-request history,
 * PMS push state) that a guest never sees.
 */
async function getHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const booking = await getBookingDetailForAdmin(id);
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  return NextResponse.json({ booking });
}

export const GET = withApiErrorHandling(getHandler);
