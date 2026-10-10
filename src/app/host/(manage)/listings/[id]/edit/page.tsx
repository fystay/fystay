import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ListingForm } from "@/components/ListingForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // Scoped to the signed-in host: the title is sent before the page's own
  // ownership check runs, so an unscoped lookup would name anyone's listing.
  const session = await auth();
  const listing = session?.user
    ? await prisma.listing.findFirst({ where: { id, hostId: session.user.id }, select: { title: true } })
    : null;
  return {
    title: listing ? `Edit ${listing.title}` : "Edit listing",
    robots: { index: false },
  };
}

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=/host/listings/${id}/edit`);

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: { roomTypes: { orderBy: { createdAt: "asc" } } },
  });
  if (!listing) notFound();
  if (listing.hostId !== session.user.id) redirect("/host/dashboard");

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <h1 className="mb-6 text-2xl font-bold">Edit listing</h1>
      <ListingForm
        listingId={listing.id}
        initialValues={{
          title: listing.title,
          description: listing.description,
          city: listing.city,
          country: listing.country,
          propertyType: listing.propertyType,
          address: listing.address ?? "",
          pricePerNight: (listing.pricePerNightCents / 100).toString(),
          weekendPricePerNight:
            listing.weekendPricePerNightCents !== null ? (listing.weekendPricePerNightCents / 100).toString() : "",
          cleaningFee: listing.cleaningFeeCents > 0 ? (listing.cleaningFeeCents / 100).toString() : "",
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
        }}
      />
    </div>
  );
}
