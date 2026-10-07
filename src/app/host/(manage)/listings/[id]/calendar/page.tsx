import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { IcalSync } from "@/components/IcalSync";
import { SITE_URL } from "@/lib/seo";
import { cn } from "@/lib/cn";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await prisma.listing.findUnique({ where: { id }, select: { title: true } });
  return {
    title: listing ? `Calendar · ${listing.title}` : "Availability calendar",
    robots: { index: false },
  };
}

const BOOKING_ROW_SELECT = {
  id: true,
  checkIn: true,
  checkOut: true,
  status: true,
  guests: true,
  guestName: true,
  reference: true,
} as const;

export default async function ListingCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ roomType?: string }>;
}) {
  const { id } = await params;
  const { roomType: roomTypeParam } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=/host/listings/${id}/calendar`);

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      bookings: {
        where: { status: { in: ["PENDING", "CONFIRMED"] } },
        select: BOOKING_ROW_SELECT,
        orderBy: { checkIn: "asc" },
      },
      availabilityBlocks: { orderBy: { startDate: "asc" } },
      roomTypes: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!listing) notFound();
  if (listing.hostId !== session.user.id) redirect("/host/dashboard");

  const isHotel = listing.propertyType === "HOTEL";
  // Default to the first room type so a hotel's calendar never lands empty
  // just because the URL didn't name one yet.
  const selectedRoomTypeId = isHotel
    ? listing.roomTypes.find((rt) => rt.id === roomTypeParam)?.id ?? listing.roomTypes[0]?.id
    : undefined;

  const [roomTypeBookings, roomTypeBlocks] = selectedRoomTypeId
    ? await Promise.all([
        prisma.booking.findMany({
          where: { roomTypeId: selectedRoomTypeId, status: { in: ["PENDING", "CONFIRMED"] } },
          select: BOOKING_ROW_SELECT,
          orderBy: { checkIn: "asc" },
        }),
        prisma.availabilityBlock.findMany({
          where: { roomTypeId: selectedRoomTypeId },
          orderBy: { startDate: "asc" },
        }),
      ])
    : [[], []];

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <Link
        href="/host/dashboard"
        className="focus-ring -ml-1 inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-stone-600 hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to dashboard
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-foreground">{listing.title}</h1>
      <p className="mt-1 text-sm text-stone-500">Availability calendar</p>

      {isHotel && (
        <div className="mt-4 flex flex-wrap gap-2">
          {listing.roomTypes.length === 0 ? (
            <p className="text-sm text-stone-500">
              Add a room type on the listing&apos;s edit page to manage its calendar.
            </p>
          ) : (
            listing.roomTypes.map((roomType) => (
              <Link
                key={roomType.id}
                href={`/host/listings/${listing.id}/calendar?roomType=${roomType.id}`}
                className={cn(
                  "focus-ring rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  roomType.id === selectedRoomTypeId
                    ? "border-brand-600 bg-brand-50 text-brand-800"
                    : "border-border-subtle text-stone-600 hover:bg-surface-muted",
                )}
              >
                {roomType.name}
              </Link>
            ))
          )}
        </div>
      )}

      {(!isHotel || selectedRoomTypeId) && (
        <AvailabilityCalendar
          listingId={listing.id}
          roomTypeId={selectedRoomTypeId}
          bookings={isHotel ? roomTypeBookings : listing.bookings}
          blocks={isHotel ? roomTypeBlocks : listing.availabilityBlocks}
        />
      )}

      {!isHotel && (
        <div className="mt-6">
          <IcalSync
            listingId={listing.id}
            exportUrl={`${SITE_URL}/api/listings/${listing.id}/calendar.ics?token=${listing.icalExportToken}`}
            initialImportUrl={listing.icalImportUrl}
            syncedAt={listing.icalSyncedAt}
          />
        </div>
      )}
    </div>
  );
}
