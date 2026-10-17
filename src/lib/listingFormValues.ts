import type { Listing, RoomType } from "@prisma/client";
import type { ListingFormValues } from "@/components/ListingForm";

/**
 * A stored listing as ListingForm's starting values - shared by the host's
 * edit page and the admin page where FYStay prepares a listing, so both
 * edit exactly the same fields the same way. A draft FYStay has only just
 * started has no price yet (0), shown as an empty box rather than "0".
 */
export function listingFormValues(listing: Listing & { roomTypes: RoomType[] }): ListingFormValues {
  return {
    title: listing.title,
    description: listing.description,
    city: listing.city,
    country: listing.country,
    propertyType: listing.propertyType,
    address: listing.address ?? "",
    pricePerNight: listing.pricePerNightCents > 0 ? (listing.pricePerNightCents / 100).toString() : "",
    weekendPricePerNight:
      listing.weekendPricePerNightCents !== null ? (listing.weekendPricePerNightCents / 100).toString() : "",
    securityDeposit:
      listing.securityDepositCents > 0 ? (listing.securityDepositCents / 100).toString() : "",
    weeklyDiscountPercent: listing.weeklyDiscountPercent?.toString() ?? "",
    monthlyDiscountPercent: listing.monthlyDiscountPercent?.toString() ?? "",
    lastMinuteDiscountPercent: listing.lastMinuteDiscountPercent?.toString() ?? "",
    lastMinuteWindowDays: listing.lastMinuteWindowDays?.toString() ?? "7",
    maxGuests: listing.maxGuests.toString(),
    bedrooms: listing.bedrooms.toString(),
    beds: listing.beds.toString(),
    bathrooms: listing.bathrooms.toString(),
    photos: listing.photos,
    amenities: listing.amenities,
    cancellationPolicy: listing.cancellationPolicy,
    customCancellationCutoffDays: (listing.customCancellationCutoffDays ?? 7).toString(),
    customCancellationRefundPercent: (
      listing.customCancellationRefundPercent ?? 50
    ).toString(),
    minNights: listing.minNights.toString(),
    maxNights: listing.maxNights?.toString() ?? "",
    instantBook: listing.instantBook,
    checkInTime: listing.checkInTime ?? "",
    checkOutTime: listing.checkOutTime ?? "",
    selfCheckIn: listing.selfCheckIn,
    checkInInstructions: listing.checkInInstructions ?? "",
    wifiNetwork: listing.wifiNetwork ?? "",
    wifiPassword: listing.wifiPassword ?? "",
    smokingAllowed: listing.smokingAllowed,
    partiesAllowed: listing.partiesAllowed,
    quietHoursStart: listing.quietHoursStart ?? "",
    quietHoursEnd: listing.quietHoursEnd ?? "",
    additionalRules: listing.additionalRules ?? "",
    roomTypes: listing.roomTypes.map((roomType) => ({
      id: roomType.id,
      name: roomType.name,
      description: roomType.description ?? "",
      pricePerNight: (roomType.pricePerNightCents / 100).toString(),
      maxGuests: roomType.maxGuests.toString(),
      bedrooms: roomType.bedrooms.toString(),
      beds: roomType.beds.toString(),
      bathrooms: roomType.bathrooms.toString(),
      photos: roomType.photos,
      totalRooms: roomType.totalRooms.toString(),
    })),
  };
}
