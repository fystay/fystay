import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ListingForm } from "@/components/ListingForm";
import { listingFormValues } from "@/lib/listingFormValues";

export const metadata: Metadata = { title: "Prepare listing", robots: { index: false } };

/**
 * Where FYStay fills in a prepared listing - the host's own listing form,
 * saving through the same PATCH and rules. Only for listings FYStay
 * prepared; a host's own listing is theirs to edit.
 */
export default async function AdminEditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=/admin/properties/${id}/edit`);
  if (session.user.role !== "ADMIN") redirect("/");

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: { roomTypes: { orderBy: { createdAt: "asc" } } },
  });
  if (!listing || !listing.preparedById) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <Link href={`/admin/properties/${id}`} className="text-sm font-medium text-brand-700 hover:underline">
        ← Back to the property
      </Link>
      <h1 className="mb-2 mt-3 text-2xl font-bold">Prepare the listing</h1>
      <p className="mb-6 text-sm leading-relaxed text-stone-600">
        Use only facts and photos the owner has given or confirmed. Saving keeps it private.
        {listing.reviewStatus === "HOST_APPROVED" &&
          " The host has approved it: changing a material detail (price, photos, rules, capacity and so on) sends it back to them for approval, and takes it offline if it's live."}
      </p>
      <ListingForm
        listingId={listing.id}
        initialValues={listingFormValues(listing)}
        afterSaveHref={`/admin/properties/${id}`}
        allowIncomplete={!listing.published}
      />
    </div>
  );
}
