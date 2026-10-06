import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { MIN_QUERY_LENGTH, searchBookingsForAdmin } from "@/lib/adminBookingLookup";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * Support's booking lookup - by reference, guest name/email, or host
 * name/email. Deliberately refuses an empty/trivial query rather than
 * paging the whole table: this is a support tool for finding one specific
 * booking, not a bookings export (that's a real, separate gap - see
 * docs/product-strategy.md's prioritization notes - not something to bolt
 * onto this endpoint).
 */
async function getHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const bookings = await searchBookingsForAdmin(q);
  if (bookings === null) {
    return NextResponse.json(
      { error: `Enter at least ${MIN_QUERY_LENGTH} characters to search` },
      { status: 400 },
    );
  }

  return NextResponse.json({ bookings });
}

export const GET = withApiErrorHandling(getHandler);
