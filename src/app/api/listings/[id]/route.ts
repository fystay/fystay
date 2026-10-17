import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { httpUrlSchema, listingFieldSchemas } from "@/lib/validation";
import { isFetchableUrl } from "@/lib/safeFetch";
import { isFystayCalendarExport } from "@/lib/icalSync";
import { locateListing } from "@/lib/geocoding";
import { PRIVATE_LISTING_FIELDS } from "@/lib/listingPrivacy";
import { withApiErrorHandling } from "@/lib/apiError";
import { priceChangeFields } from "@/lib/deals";
import { weekendRateError } from "@/lib/pricing";
import { lastMinuteDealInput, resolveLastMinuteDeal } from "@/lib/dealValidation";
import { minimumPayoutError } from "@/lib/dynamicPricing";
import { listingTimesError } from "@/lib/listingTimes";
import { PROPERTY_TYPES, type PropertyType } from "@/lib/propertyType";
import { materialChanges, materialSnapshot, reviewEffectsOfEdit } from "@/lib/listingReview";
import {
  canManageListing,
  isListingHost,
  PUBLICATION_LISTING_SELECT,
  publicationState,
  recordReviewEvent,
} from "@/lib/listingOnboarding";

const updateListingFields = z.object({
  title: listingFieldSchemas.title.optional(),
  description: listingFieldSchemas.description.optional(),
  propertyType: z.enum(PROPERTY_TYPES as [PropertyType, ...PropertyType[]]).optional(),
  city: z.string().min(1).max(100).optional(),
  country: z.string().min(1).max(100).optional(),
  address: z.string().max(200).optional(),
  pricePerNightCents: listingFieldSchemas.pricePerNightCents.optional(),
  weekendPricePerNightCents: listingFieldSchemas.pricePerNightCents.nullable().optional(),
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
  cancellationPolicy: z.enum(["FLEXIBLE", "MODERATE", "STRICT", "NON_REFUNDABLE", "CUSTOM"]).optional(),
  customCancellationCutoffDays: z.number().int().min(0).max(90).optional(),
  customCancellationRefundPercent: z.number().int().min(0).max(100).optional(),
  minNights: z.number().int().min(1).max(365).optional(),
  maxNights: z.number().int().min(1).max(365).nullable().optional(),
  checkInTime: z.string().max(50).nullable().optional(),
  checkOutTime: z.string().max(50).nullable().optional(),
  selfCheckIn: z.boolean().optional(),
  instantBook: z.boolean().optional(),
  securityDepositCents: listingFieldSchemas.securityDepositCents.optional(),
  checkInInstructions: z.string().max(2000).nullable().optional(),
  wifiNetwork: z.string().max(100).nullable().optional(),
  wifiPassword: z.string().max(100).nullable().optional(),
  smokingAllowed: z.boolean().optional(),
  partiesAllowed: z.boolean().optional(),
  quietHoursStart: z.string().max(50).nullable().optional(),
  quietHoursEnd: z.string().max(50).nullable().optional(),
  additionalRules: z.string().max(2000).nullable().optional(),
  icalImportUrl: httpUrlSchema
    .max(2000)
    .refine(isFetchableUrl, { message: "Use the calendar's public web link (http or https)" })
    .refine((url) => !isFystayCalendarExport(url), {
      message: "That's a FYStay calendar link. Paste the export link from Airbnb, Vrbo or your other calendar instead.",
    })
    .nullable()
    .optional(),
});

// A private draft FYStay is preparing can be saved part-filled: no
// description, photos or price yet. publicationBlockers still requires all
// three before it can go live, so this never lets an incomplete listing out.
const draftListingFields = updateListingFields.extend({
  description: z.string().trim().max(5000).optional(),
  photos: z.array(httpUrlSchema).optional(),
  pricePerNightCents: z.number().int().min(0).max(1_000_000).optional(),
});

function withListingRefinements<T extends typeof updateListingFields | typeof draftListingFields>(fields: T) {
  return fields
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
}

const updateListingSchema = withListingRefinements(updateListingFields);
const draftUpdateSchema = withListingRefinements(draftListingFields);

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
  // The host, or an admin for a listing FYStay prepared (see
  // src/lib/listingOnboarding.ts) - never another host.
  if (!canManageListing(session, listing)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const isPreparedDraft = listing.preparedById !== null && !listing.published;
  const parsed = (isPreparedDraft ? draftUpdateSchema : updateListingSchema).safeParse(body);
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

  // Times must come from the picker ("HH:MM"), except an older free-text
  // value re-sent exactly as saved; quiet hours are checked as they'll end
  // up after this save, against the persisted half when only one is sent.
  const timesError = listingTimesError(parsed.data, listing);
  if (timesError) {
    return NextResponse.json({ error: timesError }, { status: 400 });
  }

  // Checked against the persisted values too: raising only the weekday
  // price above an existing weekend price would otherwise slip through.
  const weekendError = weekendRateError({
    pricePerNightCents: parsed.data.pricePerNightCents ?? listing.pricePerNightCents,
    weekendPricePerNightCents:
      parsed.data.weekendPricePerNightCents !== undefined
        ? parsed.data.weekendPricePerNightCents
        : listing.weekendPricePerNightCents,
    propertyType: parsed.data.propertyType ?? listing.propertyType,
  });
  if (weekendError) {
    return NextResponse.json({ error: weekendError }, { status: 400 });
  }

  // Re-locate only when where the listing is actually changed - an edit to
  // the price or description shouldn't move the map pin for no reason.
  // Falls back to null (not the stale old pin) if the new place can't be
  // found, same as a brand-new listing there would.
  const moved =
    (parsed.data.city !== undefined && parsed.data.city !== listing.city) ||
    (parsed.data.address !== undefined && parsed.data.address !== listing.address) ||
    (parsed.data.country !== undefined && parsed.data.country !== listing.country);
  const coordinates = moved
    ? await locateListing({
        id: listing.id,
        city: parsed.data.city ?? listing.city,
        country: parsed.data.country ?? listing.country,
        address: parsed.data.address !== undefined ? parsed.data.address : listing.address,
      })
    : undefined;

  const deal = resolveLastMinuteDeal(parsed.data, listing);
  if ("error" in deal) {
    return NextResponse.json({ error: deal.error }, { status: 400 });
  }

  // A host's smart-pricing minimum payout has to stay reachable: a lower
  // price or a bigger discount that would break it is refused here, rather
  // than silently paying the host less (see minimumPayoutError).
  if (listing.smartPricingEnabled) {
    const payoutError = minimumPayoutError(listing.smartPricingMinPayoutCents, {
      pricePerNightCents: parsed.data.pricePerNightCents ?? listing.pricePerNightCents,
      weeklyDiscountPercent: parsed.data.weeklyDiscountPercent !== undefined ? parsed.data.weeklyDiscountPercent : listing.weeklyDiscountPercent,
      monthlyDiscountPercent: parsed.data.monthlyDiscountPercent !== undefined ? parsed.data.monthlyDiscountPercent : listing.monthlyDiscountPercent,
      lastMinuteDiscountPercent: { ...listing, ...parsed.data, ...deal.fields }.lastMinuteDiscountPercent ?? null,
    });
    if (payoutError) {
      return NextResponse.json({ error: `${payoutError} (Smart pricing minimum payout - change it under Smart pricing.)` }, { status: 400 });
    }
  }

  // A changed nightly price updates the price-drop tracking behind the
  // "was" price (see priceChangeFields) - set only by the server, never by
  // the request.
  const priceTracking =
    parsed.data.pricePerNightCents !== undefined
      ? priceChangeFields(listing, parsed.data.pricePerNightCents)
      : {};

  // A new or removed import link starts its sync afresh. Removing it also
  // removes the dates it imported (only those - bookings and the host's own
  // blocks stay), so they stop blocking.
  const importLinkChanged =
    parsed.data.icalImportUrl !== undefined && parsed.data.icalImportUrl !== listing.icalImportUrl;
  if (importLinkChanged && parsed.data.icalImportUrl === null) {
    await prisma.availabilityBlock.deleteMany({ where: { listingId: id, source: "ICAL_IMPORT" } });
  }

  const changes = {
    ...parsed.data,
    ...deal.fields,
    ...priceTracking,
    ...(coordinates !== undefined && {
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
    }),
  };

  // Host review (src/lib/listingReview.ts): a material change by FYStay to
  // a listing the host already approved sends it back to them - and takes
  // it down if it was live - so guests never see facts the host hasn't
  // approved.
  const materialChangeLabels = materialChanges(materialSnapshot(listing), materialSnapshot({ ...listing, ...changes }));
  const actor = { id: session.user.id, role: session.user.role, isListingHost: isListingHost(session, listing) };
  const review = reviewEffectsOfEdit({ listing, changes: materialChangeLabels, actor });
  const published = review.unpublish ? false : parsed.data.published;

  // Going live: the same publication checks for every listing, whoever
  // created it - see publicationBlockers.
  if (published === true && !listing.published) {
    const current = await prisma.listing.findUniqueOrThrow({ where: { id }, select: PUBLICATION_LISTING_SELECT });
    const { blockers } = publicationState({
      ...current,
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      ...(parsed.data.city !== undefined && { city: parsed.data.city }),
      ...(parsed.data.photos !== undefined && { photos: parsed.data.photos }),
      ...(parsed.data.pricePerNightCents !== undefined && { pricePerNightCents: parsed.data.pricePerNightCents }),
      ...(parsed.data.propertyType !== undefined && { propertyType: parsed.data.propertyType }),
      reviewStatus: review.reviewStatus ?? current.reviewStatus,
    });
    if (blockers.length > 0) {
      return NextResponse.json(
        { error: `This listing can't go live yet. ${blockers[0].message}`, code: "publication_blocked", blockers },
        { status: 409 },
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.listing.update({
      where: { id },
      data: {
        ...changes,
        ...(importLinkChanged && { icalSyncedAt: null, icalSyncError: null, icalSyncFailedAt: null }),
        published,
        materialRevision: review.materialRevision,
        ...(review.reviewStatus && { reviewStatus: review.reviewStatus }),
      },
    });
    if (listing.preparedById) {
      const eventActor = { id: session.user.id, role: session.user.role };
      if (review.approvalInvalidated) {
        await recordReviewEvent(tx, {
          listingId: id,
          type: "APPROVAL_INVALIDATED",
          revision: saved.materialRevision,
          actor: eventActor,
          note: `FYStay changed: ${materialChangeLabels.join(", ")}`,
        });
      }
      if (saved.published !== listing.published) {
        await recordReviewEvent(tx, {
          listingId: id,
          type: saved.published ? "PUBLISHED" : "UNPUBLISHED",
          revision: saved.materialRevision,
          actor: eventActor,
        });
      }
    }
    return saved;
  });

  return NextResponse.json({
    listing: updated,
    ...(review.approvalInvalidated && {
      notice: `Sent back to the host for approval because these changed: ${materialChangeLabels.join(", ")}.${review.unpublish ? " It's hidden from guests until they approve." : ""}`,
    }),
  });
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

  // Deleting a listing deletes its bookings with it (Booking.listing is
  // onDelete: Cascade) - every stay's record, payment and review. So only a
  // listing no guest has ever paid for, and with nothing in flight, can be
  // deleted; anything else is unpublished instead, which hides it from
  // guests and keeps the history. A booking that never got past an
  // abandoned checkout or a declined request doesn't count.
  const bookingsToKeep = await prisma.booking.count({
    where: {
      listingId: id,
      OR: [{ paidAt: { not: null } }, { status: { in: ["PENDING", "CONFIRMED", "COMPLETED"] } }],
    },
  });
  if (bookingsToKeep > 0) {
    return NextResponse.json(
      {
        error:
          "This listing has bookings, so it can't be deleted - their records have to be kept. Unpublish it instead to hide it from guests.",
        code: "listing_has_bookings",
      },
      { status: 409 },
    );
  }

  await prisma.listing.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

export const GET = withApiErrorHandling(getHandler);
export const PATCH = withApiErrorHandling(patchHandler);
export const DELETE = withApiErrorHandling(deleteHandler);
