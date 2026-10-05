import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { httpUrlSchema } from "@/lib/validation";
import { geocodeListing } from "@/lib/geocoding";
import { PRIVATE_LISTING_FIELDS } from "@/lib/listingPrivacy";
import { withApiErrorHandling } from "@/lib/apiError";
import { priceChangeFields } from "@/lib/deals";
import { lastMinuteDealInput, resolveLastMinuteDeal } from "@/lib/dealValidation";

const updateListingSchema = z
  .object({
    title: z.string().min(3).max(120).optional(),
    description: z.string().min(10).max(5000).optional(),
    propertyType: z
      .enum(["APARTMENT", "HOUSE", "HOTEL", "COTTAGE", "VILLA", "STUDIO", "OTHER"])
      .optional(),
    city: z.string().min(1).max(100).optional(),
    country: z.string().min(1).max(100).optional(),
    address: z.string().max(200).optional(),
    pricePerNightCents: z.number().int().positive().optional(),
    cleaningFeeCents: z.number().int().min(0).optional(),
    weeklyDiscountPercent: z.number().int().min(0).max(90).nullable().optional(),
    monthlyDiscountPercent: z.number().int().min(0).max(90).nullable().optional(),
    ...lastMinuteDealInput,
    maxGuests: z.number().int().min(1).max(50).optional(),
    bedrooms: z.number().int().min(0).max(50).optional(),
    beds: z.number().int().min(1).max(50).optional(),
    bathrooms: z.number().int().min(0).max(50).optional(),
    photos: z.array(httpUrlSchema).min(1).optional(),
    amenities: z.array(z.string()).optional(),
    published: z.boolean().optional(),
    cancellationPolicy: z.enum(["FLEXIBLE", "MODERATE", "STRICT", "CUSTOM"]).optional(),
    customCancellationCutoffDays: z.number().int().min(0).max(90).optional(),
    customCancellationRefundPercent: z.number().int().min(0).max(100).optional(),
    minNights: z.number().int().min(1).max(365).optional(),
    maxNights: z.number().int().min(1).max(365).nullable().optional(),
    checkInTime: z.string().max(50).nullable().optional(),
    checkOutTime: z.string().max(50).nullable().optional(),
    selfCheckIn: z.boolean().optional(),
    instantBook: z.boolean().optional(),
    securityDepositCents: z.number().int().min(0).optional(),
    checkInInstructions: z.string().max(2000).nullable().optional(),
    wifiNetwork: z.string().max(100).nullable().optional(),
    wifiPassword: z.string().max(100).nullable().optional(),
    smokingAllowed: z.boolean().optional(),
    partiesAllowed: z.boolean().optional(),
    quietHoursStart: z.string().max(50).nullable().optional(),
    quietHoursEnd: z.string().max(50).nullable().optional(),
    additionalRules: z.string().max(2000).nullable().optional(),
    icalImportUrl: httpUrlSchema.nullable().optional(),
  })
  .refine(
    (data) =>
      data.cancellationPolicy !== "CUSTOM" ||
      (data.customCancellationCutoffDays !== undefined &&
        data.customCancellationRefundPercent !== undefined),
    { message: "A custom cancellation policy needs a cutoff and a refund percentage" },
  )
  .refine(
    (data) =>
      data.maxNights === undefined || data.maxNights === null || !data.minNights ||
      data.maxNights >= data.minNights,
    { message: "Maximum stay can't be shorter than the minimum stay" },
  );

async function getHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const listing = await prisma.listing.findUnique({
    where: { id },
    // This endpoint needs no login - see PRIVATE_LISTING_FIELDS.
    omit: PRIVATE_LISTING_FIELDS,
    include: { host: { select: { id: true, name: true } } },
  });

  // Unpublished or suspended listings are only ever visible via
  // host-management routes (dashboard, edit page), never through this public
  // endpoint. Matches the listing detail page, which 404s the same way
  // regardless of viewer.
  if (!listing || !listing.published || listing.suspendedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ listing });
}

async function patchHandler(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (listing.hostId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updateListingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const effectivePropertyType = parsed.data.propertyType ?? listing.propertyType;
  const flatFieldsSent = (
    ["pricePerNightCents", "maxGuests", "bedrooms", "beds", "bathrooms"] as const
  ).some((field) => parsed.data[field] !== undefined);
  if (effectivePropertyType === "HOTEL" && flatFieldsSent) {
    return NextResponse.json(
      { error: "A hotel listing's price and capacity come from its room types" },
      { status: 400 },
    );
  }

  if (parsed.data.propertyType !== undefined && parsed.data.propertyType !== listing.propertyType) {
    const hasBookings = await prisma.booking.count({ where: { listingId: id } });
    if (hasBookings > 0) {
      return NextResponse.json(
        { error: "This listing's property type can't change once it has bookings" },
        { status: 400 },
      );
    }
    const isSwitchingIntoHotel = parsed.data.propertyType === "HOTEL";
    const isSwitchingOutOfHotel = listing.propertyType === "HOTEL" && !isSwitchingIntoHotel;
    if (isSwitchingIntoHotel || isSwitchingOutOfHotel) {
      const roomTypeCount = await prisma.roomType.count({ where: { listingId: id } });
      if (isSwitchingIntoHotel && roomTypeCount === 0) {
        return NextResponse.json(
          { error: "Add at least one room type before switching this listing to Hotel" },
          { status: 400 },
        );
      }
      if (isSwitchingOutOfHotel && roomTypeCount > 0) {
        return NextResponse.json(
          { error: "Remove this listing's room types before switching it away from Hotel" },
          { status: 400 },
        );
      }
    }
  }

  if (parsed.data.published && effectivePropertyType === "HOTEL") {
    const sellableRoomTypes = await prisma.roomType.count({
      where: { listingId: id, totalRooms: { gt: 0 } },
    });
    if (sellableRoomTypes === 0) {
      return NextResponse.json(
        { error: "Add at least one room type with rooms available before publishing" },
        { status: 400 },
      );
    }
  }

  // The zod refine above only catches minNights/maxNights disagreeing
  // within the same request body - a request that only patches one of the
  // two still needs checking against the other's persisted value, since a
  // caller other than the "always submit both" host form could send either
  // alone.
  const effectiveMinNights = parsed.data.minNights ?? listing.minNights;
  const effectiveMaxNights =
    parsed.data.maxNights !== undefined ? parsed.data.maxNights : listing.maxNights;
  if (effectiveMaxNights !== null && effectiveMaxNights < effectiveMinNights) {
    return NextResponse.json(
      { error: "Maximum stay can't be shorter than the minimum stay" },
      { status: 400 },
    );
  }

  // Re-geocode only when the city actually changed - an edit to the price
  // or description shouldn't reroll the map pin's jitter for no reason.
  // Falls back to null (not the stale old pin) if the new city isn't one
  // of FYStay's towns, same as a brand-new listing in that city would.
  const coordinates =
    parsed.data.city && parsed.data.city !== listing.city
      ? geocodeListing({ id: listing.id, city: parsed.data.city })
      : undefined;

  const deal = resolveLastMinuteDeal(parsed.data, listing);
  if ("error" in deal) {
    return NextResponse.json({ error: deal.error }, { status: 400 });
  }

  // A changed nightly price updates the price-drop tracking behind the
  // "was" price (see priceChangeFields) - set only by the server, never by
  // the request.
  const priceTracking =
    parsed.data.pricePerNightCents !== undefined
      ? priceChangeFields(listing, parsed.data.pricePerNightCents)
      : {};

  const updated = await prisma.listing.update({
    where: { id },
    data: {
      ...parsed.data,
      ...deal.fields,
      ...priceTracking,
      ...(coordinates !== undefined && {
        latitude: coordinates?.latitude ?? null,
        longitude: coordinates?.longitude ?? null,
      }),
    },
  });

  return NextResponse.json({ listing: updated });
}

async function deleteHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (listing.hostId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.listing.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

export const GET = withApiErrorHandling(getHandler);
export const PATCH = withApiErrorHandling(patchHandler);
export const DELETE = withApiErrorHandling(deleteHandler);
