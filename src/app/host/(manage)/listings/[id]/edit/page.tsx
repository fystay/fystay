import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ListingForm } from "@/components/ListingForm";
import { listingFormValues } from "@/lib/listingFormValues";
import { SmartPricingPanel } from "@/components/host/SmartPricingPanel";
import { smartPricingMode } from "@/lib/smartPricingMode";
import { CURRENT_DYNAMIC_POLICY } from "@/lib/pricingPolicy";

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
  // Not a draft FYStay is still holding for an invited owner.
  if (listing.hostId !== session.user.id || listing.hostInvitationId) redirect("/host/dashboard");
  const mode = smartPricingMode();

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <h1 className="mb-6 text-2xl font-bold">Edit listing</h1>
      {listing.preparedById && listing.reviewStatus !== "HOST_APPROVED" && (
        <p className="mb-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
          FYStay prepared this listing. Saving your corrections doesn&apos;t approve it - when everything&apos;s right,{" "}
          <Link href={`/host/listings/${listing.id}/review`} className="font-semibold underline">
            approve it on the review page
          </Link>
          .
        </p>
      )}
      <ListingForm
        listingId={listing.id}
        initialValues={listingFormValues(listing)}
      />
      {/* Only once FYStay runs smart pricing (SMART_PRICING_MODE), and never
          for a hotel's room types - so it's never offered while it can't work. */}
      {mode !== "off" && listing.propertyType !== "HOTEL" && (
        <SmartPricingPanel
          listingId={listing.id}
          mode={mode}
          pricePerNightCents={listing.pricePerNightCents}
          initial={{
            enabled: listing.smartPricingEnabled,
            autoApply: listing.smartPricingAutoApply,
            consentAt: listing.smartPricingConsentAt?.toISOString() ?? null,
            consentCurrent: listing.smartPricingConsentPolicyVersion === CURRENT_DYNAMIC_POLICY.version,
            minPayoutCents: listing.smartPricingMinPayoutCents,
            targetPayoutCents: listing.smartPricingTargetPayoutCents,
            minPriceCents: listing.smartPricingMinPriceCents,
            maxPriceCents: listing.smartPricingMaxPriceCents,
            maxAdjustmentPercent: listing.smartPricingMaxAdjustmentPercent,
          }}
        />
      )}
    </div>
  );
}
