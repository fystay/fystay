import { z } from "zod";
import { httpUrlSchema, listingFieldSchemas } from "@/lib/validation";
import { lastMinuteDealInput } from "@/lib/dealValidation";

// One category of room within a HOTEL listing (see prisma/schema.prisma's
// RoomType model). Every non-hotel property type has zero of these and
// keeps using the flat price/capacity fields below directly.
const roomTypeInputSchema = z.object({
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

/** What a host submits to create a listing - shared by POST /api/listings and the one-off owner import scripts under scripts/listings, so both are held to exactly the same rules. */
export const createListingSchema = z
  .object({
    title: listingFieldSchemas.title,
    description: listingFieldSchemas.description,
    propertyType: z
      .enum(["APARTMENT", "HOUSE", "HOTEL", "COTTAGE", "VILLA", "STUDIO", "OTHER"])
      .optional(),
    city: z.string().min(1).max(100),
    country: z.string().min(1).max(100),
    address: z.string().max(200).optional(),
    // Required for every non-HOTEL property type (enforced below, since a
    // HOTEL listing instead takes its price/capacity from roomTypes and
    // these are simply ignored if a client somehow still sends them).
    pricePerNightCents: listingFieldSchemas.pricePerNightCents.optional(),
    // Friday/Saturday rate; null or omitted means every night is pricePerNightCents.
    weekendPricePerNightCents: listingFieldSchemas.pricePerNightCents.nullable().optional(),
    cleaningFeeCents: listingFieldSchemas.cleaningFeeCents.default(0),
    weeklyDiscountPercent: z.number().int().min(0).max(90).nullable().optional(),
    monthlyDiscountPercent: z.number().int().min(0).max(90).nullable().optional(),
    ...lastMinuteDealInput,
    maxGuests: z.number().int().min(1).max(50).optional(),
    bedrooms: z.number().int().min(0).max(50).optional(),
    beds: z.number().int().min(1).max(50).optional(),
    bathrooms: z.number().int().min(0).max(50).optional(),
    photos: z.array(httpUrlSchema).min(1),
    amenities: z.array(z.string()).default([]),
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
    roomTypes: z.array(roomTypeInputSchema).optional(),
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
  )
  .superRefine((data, ctx) => {
    if (data.propertyType === "HOTEL") {
      if (!data.roomTypes || data.roomTypes.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A hotel listing needs at least one room type",
          path: ["roomTypes"],
        });
      }
      return;
    }
    // Every non-hotel property type keeps requiring its own flat
    // price/capacity fields, exactly as before roomTypes existed.
    const requiredFields = ["pricePerNightCents", "maxGuests", "bedrooms", "beds", "bathrooms"] as const;
    for (const field of requiredFields) {
      if (data[field] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Required",
          path: [field],
        });
      }
    }
  });

export type CreateListingInput = z.input<typeof createListingSchema>;
