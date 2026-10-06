import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Luggage } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { blockingBookingWhere } from "@/lib/availability";
import { completePastBookings, expireAbandonedCheckouts, isAbandonedReservation } from "@/lib/bookingLifecycle";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { BookingsTabs } from "@/components/BookingsTabs";
import { getActiveOfferingByCategory } from "@/lib/travelAddons";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "My trips", robots: { index: false } };

function EmptySection({ message, hint, showCta }: { message: string; hint: string; showCta?: boolean }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-12 text-center">
      <Luggage className="h-8 w-8 text-stone-300" />
      <p className="font-medium text-foreground">{message}</p>
      <p className="max-w-sm text-sm text-stone-500">{hint}</p>
      {showCta && (
        <Link href="/" className={cn(buttonVariants(), "mt-2")}>
          Start exploring
        </Link>
      )}
    </Card>
  );
}

export default async function BookingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/bookings");
  }

  await completePastBookings(prisma, session.user.id);
  await expireAbandonedCheckouts(prisma, { guestId: session.user.id });

  const [allBookings, airportTransferOffering] = await Promise.all([
    prisma.booking.findMany({
      where: { guestId: session.user.id },
      include: {
        listing: {
          include: {
            bookings: {
              where: blockingBookingWhere(),
              select: { id: true, checkIn: true, checkOut: true },
            },
          },
        },
        review: true,
        changeRequests: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    }),
    getActiveOfferingByCategory("AIRPORT_TRANSFER"),
  ]);
  // A reservation that was never paid for isn't a trip (see isAbandonedReservation).
  const bookings = allBookings.filter((booking) => !isAbandonedReservation(booking));

  // "Your journey" (item 5 of the cross-sell brief) only ever needs to
  // know whether *a* paid airport transfer exists per booking, not which
  // offering - a guest could in principle have bought more than one over
  // time, but this only ever needs a yes/no per booking.
  const bookingIdsWithTransfer = airportTransferOffering
    ? new Set(
        (
          await prisma.bookingExtra.findMany({
            where: {
              bookingId: { in: bookings.map((b) => b.id) },
              offering: { category: "AIRPORT_TRANSFER" },
              status: "PAID",
            },
            select: { bookingId: true },
          })
        ).map((extra) => extra.bookingId),
      )
    : new Set<string>();

  if (bookings.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <h1 className="text-2xl font-bold">My trips</h1>
        <div className="mt-8">
          <EmptySection
            message="No trips booked yet"
            hint="Time to dust off your bags and start planning your next adventure."
            showCta
          />
        </div>
      </div>
    );
  }

  // completePastBookings above already keeps status truthful against the
  // current date, so bucketing by status alone (no extra date math here) is
  // enough to sort these into the right section.
  const withJourney = bookings.map((b) => ({
    ...b,
    hasAirportTransfer: bookingIdsWithTransfer.has(b.id),
  }));
  const upcoming = withJourney
    .filter((b) => b.status === "PENDING" || b.status === "CONFIRMED")
    .sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
  const past = withJourney
    .filter((b) => b.status === "COMPLETED")
    .sort((a, b) => b.checkOut.getTime() - a.checkOut.getTime());
  const cancelled = withJourney
    .filter((b) => b.status === "CANCELLED" || b.status === "REFUNDED")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <h1 className="text-2xl font-bold">My trips</h1>

      <BookingsTabs
        upcoming={upcoming}
        past={past}
        cancelled={cancelled}
        airportTransferProviderName={airportTransferOffering?.providerName ?? null}
      />
    </div>
  );
}
