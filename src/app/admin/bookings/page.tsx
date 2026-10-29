import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarSearch } from "lucide-react";
import { auth } from "@/auth";
import { SectionHeading } from "@/components/SectionHeading";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminBookingSearch } from "@/components/admin/AdminBookingSearch";

export const metadata: Metadata = { title: "Bookings", robots: { index: false } };

/**
 * Support's booking lookup - the gap the rest of this admin section didn't
 * cover: /admin only shows aggregate metrics, with no way to find one
 * specific booking to answer a "what happened to my reservation" support
 * request, let alone cancel/refund it manually. See
 * src/app/api/admin/bookings/route.ts for the search itself.
 */
export default async function AdminBookingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/bookings");
  if (session.user.role !== "ADMIN") redirect("/");

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Bookings</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
        Look up a specific booking by reference, guest, or host to answer a support request or
        manually cancel and refund it.
      </p>

      <div className="mt-6">
        <AdminNav active="/admin/bookings" />
      </div>

      <div className="mt-8">
        <SectionHeading icon={CalendarSearch}>Search bookings</SectionHeading>
        <div className="mt-3">
          <AdminBookingSearch />
        </div>
      </div>
    </div>
  );
}
