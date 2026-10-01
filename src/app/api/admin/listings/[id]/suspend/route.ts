import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";

const suspendListingSchema = z.object({
  suspended: z.boolean(),
  // Only meaningful when suspending (suspended: true) - ignored, and the
  // stored reason cleared, when unsuspending. See the schema comment on
  // Listing.suspendedReason.
  reason: z.string().trim().max(1000).optional(),
});

/**
 * Admin-only listing suspension - pulls a fraudulent or problem listing
 * out of search and booking (see src/app/api/listings/route.ts,
 * src/components/search/ListingsGrid.tsx, and the booking-creation checks
 * in src/app/api/bookings/route.ts) without deleting it. The listing's own
 * host (and any admin) can still open its detail page to see why - see
 * src/app/listings/[id]/page.tsx.
 */
async function patchHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = suspendListingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const updated = await prisma.listing.update({
    where: { id },
    data: parsed.data.suspended
      ? { suspendedAt: new Date(), suspendedReason: parsed.data.reason || null }
      : { suspendedAt: null, suspendedReason: null },
  });

  return NextResponse.json({
    listing: {
      id: updated.id,
      suspendedAt: updated.suspendedAt,
      suspendedReason: updated.suspendedReason,
    },
  });
}

export const PATCH = withApiErrorHandling(patchHandler);
