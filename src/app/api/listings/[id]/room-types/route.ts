import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { httpUrlSchema, listingFieldSchemas } from "@/lib/validation";
import { recomputeListingAggregatesFromRoomTypes } from "@/lib/roomTypeAggregates";
import { withApiErrorHandling } from "@/lib/apiError";

const createRoomTypeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).nullable().optional(),
  pricePerNightCents: listingFieldSchemas.pricePerNightCents,
  maxGuests: z.number().int().min(1).max(50),
  bedrooms: z.number().int().min(0).max(50),
  beds: z.number().int().min(1).max(50),
  bathrooms: z.number().int().min(0).max(50),
  photos: z.array(httpUrlSchema).min(1),
  totalRooms: z.number().int().min(1).max(500),
});

/** A host adding a new room type to their own HOTEL listing. */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (listing.propertyType !== "HOTEL") {
    return NextResponse.json(
      { error: "Room types can only be added to a Hotel listing" },
      { status: 400 },
    );
  }

  const body = await request.json();
  const parsed = createRoomTypeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const roomType = await prisma.$transaction(async (tx) => {
    const created = await tx.roomType.create({
      data: { ...parsed.data, listingId: id },
    });
    await recomputeListingAggregatesFromRoomTypes(tx, id);
    return created;
  });

  return NextResponse.json({ roomType }, { status: 201 });
}

export const POST = withApiErrorHandling(postHandler);
