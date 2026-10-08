import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Heart } from "lucide-react";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { blockingBookingWhere } from "@/lib/availability";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { WishlistItem } from "@/components/WishlistItem";
import { PROPERTY_TYPE_LABEL } from "@/lib/propertyType";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Wishlist", robots: { index: false } };

export default async function WishlistPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/wishlist");
  }

  const saved = await prisma.savedListing.findMany({
    where: { userId: session.user.id },
    include: {
      listing: {
        include: {
          bookings: {
            where: blockingBookingWhere(),
            select: { checkIn: true, checkOut: true },
          },
          reviews: { where: { status: "PUBLISHED" }, select: { rating: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const listings = saved.filter((s) => s.listing.published).map((s) => s.listing);

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <h1 className="text-2xl font-bold">Wishlist</h1>

      {listings.length === 0 ? (
        <Card className="mt-8 flex flex-col items-center gap-3 p-12 text-center">
          <Heart className="h-8 w-8 text-stone-300" />
          <p className="font-medium text-foreground">No saved stays yet</p>
          <p className="max-w-sm text-sm text-stone-500">
            Tap the heart on any listing to save it here for later.
          </p>
          <Link href="/" className={cn(buttonVariants(), "mt-2")}>
            Start exploring
          </Link>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
          {listings.map((listing) => (
            <WishlistItem
              key={listing.id}
              listing={listing}
              propertyTypeLabel={PROPERTY_TYPE_LABEL[listing.propertyType]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
