import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/AdminNav";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { StageBadge } from "@/components/onboarding/StageBadge";
import { PUBLICATION_LISTING_SELECT, fystayListingReviewRequired, publicationState } from "@/lib/listingOnboarding";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Add a property", robots: { index: false } };

/**
 * Listings FYStay is preparing for property owners (admin-assisted
 * onboarding - see src/lib/listingReview.ts), each with who owns it, where
 * it is in review and the next thing stopping it going live - plus, where
 * FYStay review is on, listings hosts created themselves that are waiting
 * for FYStay's approval.
 */
export default async function AdminPropertiesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/properties");
  if (session.user.role !== "ADMIN") redirect("/");

  const listings = await prisma.listing.findMany({
    where: {
      OR: [
        { preparedById: { not: null } },
        ...(fystayListingReviewRequired() ? [{ preparedById: null, approvedRevision: null, published: false, suspendedAt: null }] : []),
      ],
    },
    select: { ...PUBLICATION_LISTING_SELECT, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Properties FYStay is preparing</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
            Draft a listing for an owner, send it to them to check and approve, then publish it once every check passes.
            Drafts stay private until then. New listings hosts create themselves also appear here until FYStay approves them.
          </p>
        </div>
        <Link href="/admin/properties/new" className={buttonVariants()}>
          Add a property
        </Link>
      </div>

      <div className="mt-6">
        <AdminNav active="/admin/properties" />
      </div>

      {listings.length === 0 ? (
        <p className="mt-8 text-sm text-stone-600">No properties yet. Use “Add a property” to start one.</p>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {listings.map((listing) => {
            const { blockers, stage } = publicationState(listing);
            const owner = listing.hostInvitationId ? listing.hostInvitation : listing.host;
            return (
              <li key={listing.id}>
                <Card className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/admin/properties/${listing.id}`} className="font-semibold text-foreground hover:underline">
                        {listing.title}
                      </Link>
                      <p className="mt-1 text-sm text-stone-600">
                        {listing.city} · Owner: {owner?.name ?? "Unknown"} ({owner?.email})
                        {listing.hostInvitationId && " · invitation not accepted yet"}
                      </p>
                    </div>
                    <StageBadge stage={stage} />
                  </div>
                  <p className="mt-3 text-sm text-stone-700">
                    {stage === "live"
                      ? "Live and bookable (subject to the host's payouts and any suspension)."
                      : blockers[0]
                        ? `Next: ${blockers[0].message}`
                        : "Every check passes - ready to publish."}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">Updated {formatDate(listing.updatedAt)}</p>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
