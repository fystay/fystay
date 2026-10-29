import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/AdminNav";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { StageBadge } from "@/components/onboarding/StageBadge";
import { PropertyActions } from "@/components/onboarding/PropertyActions";
import { ReviewTimeline } from "@/components/onboarding/ReviewTimeline";
import { BlockerList } from "@/components/onboarding/BlockerList";
import { PUBLICATION_LISTING_SELECT, publicationState } from "@/lib/listingOnboarding";
import { isPubliclyBookable, STAGE_LABEL } from "@/lib/listingReview";
import { payoutReadinessRequired } from "@/lib/stripeConnect";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Property", robots: { index: false } };

export default async function AdminPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=/admin/properties/${id}`);
  if (session.user.role !== "ADMIN") redirect("/");

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: {
      ...PUBLICATION_LISTING_SELECT,
      approvedAt: true,
      approvedBy: { select: { name: true } },
      icalImportUrl: true,
      icalSyncedAt: true,
      hostInvitation: {
        select: { id: true, name: true, email: true, phone: true, consentNote: true, sentAt: true, acceptedAt: true },
      },
      reviewEvents: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, type: true, revision: true, note: true, createdAt: true, actorRole: true, actor: { select: { name: true } } },
      },
    },
  });
  if (!listing) notFound();

  const { blockers, stage } = publicationState(listing);
  const searchable = isPubliclyBookable({ listing, host: listing.host, payoutsRequired: payoutReadinessRequired() });
  const invitation = listing.hostInvitation;
  const latestChangeRequest = listing.reviewEvents.find((event) => event.type === "CHANGES_REQUESTED");
  const accessGranted = listing.reviewEvents.find((event) => event.type === "HOST_ACCESS_GRANTED");
  const owner = listing.hostInvitationId && invitation ? invitation : listing.host;

  const access = listing.hostInvitationId
    ? invitation?.sentAt
      ? `Invitation emailed ${formatDateTime(invitation.sentAt)} - not accepted yet.`
      : "Invitation not sent yet."
    : accessGranted
      ? `Yes - accepted their invitation ${formatDateTime(accessGranted.createdAt)}; it's under Hosting → Listings.`
      : listing.preparedById
        ? "Yes - an existing host; they can open it from Hosting → Listings."
        : "Yes - the host created this listing themselves.";

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <Link href="/admin/properties" className="text-sm font-medium text-brand-700 hover:underline">
        ← Properties
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{listing.title}</h1>
          <p className="mt-1 text-sm text-stone-600">
            {listing.city} · Revision {listing.materialRevision}
          </p>
        </div>
        <StageBadge stage={stage} />
      </div>
      <div className="mt-6">
        <AdminNav active="/admin/properties" />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link href={`/admin/properties/${id}/edit`} className={buttonVariants({ variant: "outline" })}>
          Edit details
        </Link>
        <Link href={`/listings/${id}`} className={buttonVariants({ variant: "outline" })}>
          Preview as guests will see it
        </Link>
      </div>

      <Card className="mt-6 p-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-[13rem_1fr]">
          <dt className="font-medium text-stone-500">Who owns it</dt>
          <dd className="text-foreground">
            {owner.name} ({owner.email})
            {listing.hostInvitationId && invitation?.phone ? ` · ${invitation.phone}` : ""}
            {invitation && (
              <span className="mt-1 block text-stone-600">Permission to contact: {invitation.consentNote}</span>
            )}
          </dd>

          <dt className="font-medium text-stone-500">Host has access</dt>
          <dd className="text-foreground">{access}</dd>

          <dt className="font-medium text-stone-500">Review</dt>
          <dd className="text-foreground">{STAGE_LABEL[stage]}</dd>

          <dt className="font-medium text-stone-500">Changes the host asked for</dt>
          <dd className="text-foreground">
            {listing.reviewStatus === "CHANGES_REQUESTED" && latestChangeRequest ? (
              <span className="block whitespace-pre-line rounded-lg bg-amber-50 p-3 text-amber-950">
                {latestChangeRequest.note}
                <span className="mt-1 block text-xs text-amber-800">{formatDateTime(latestChangeRequest.createdAt)}</span>
              </span>
            ) : latestChangeRequest ? (
              "None outstanding (earlier requests are in the history below)."
            ) : (
              "None."
            )}
          </dd>

          <dt className="font-medium text-stone-500">Approved revision</dt>
          <dd className="text-foreground">
            {listing.approvedRevision
              ? `Revision ${listing.approvedRevision}, approved by ${listing.approvedBy?.name ?? "the host"} on ${formatDate(listing.approvedAt!)}${
                  listing.approvedRevision !== listing.materialRevision
                    ? listing.reviewStatus === "HOST_APPROVED" || !listing.preparedById
                      ? ` (the host has since made their own changes - now revision ${listing.materialRevision})`
                      : ` - FYStay has changed it since (now revision ${listing.materialRevision}), so it needs approving again`
                    : ""
                }.`
              : "Not approved yet."}
          </dd>

          <dt className="font-medium text-stone-500">Availability</dt>
          <dd className="text-foreground">
            {listing.icalImportUrl
              ? `Synced from an external calendar${listing.icalSyncedAt ? `, last synced ${formatDateTime(listing.icalSyncedAt)}` : " (not synced yet)"}.`
              : "Managed on FYStay's calendar - no other platform's calendar is connected. If the property is also listed elsewhere, the host should add that calendar link to avoid double bookings."}
          </dd>

          <dt className="font-medium text-stone-500">Live and searchable</dt>
          <dd className="text-foreground">
            {searchable
              ? "Yes - guests can find and book it."
              : listing.published
                ? "Published, but hidden from guests until the host's payouts are set up."
                : "No - guests can't see it."}
          </dd>
        </dl>
      </Card>

      <section className="mt-8" aria-labelledby="blockers-title">
        <h2 id="blockers-title" className="text-lg font-semibold text-foreground">
          {stage === "live" ? "Live" : "What's stopping it going live"}
        </h2>
        <BlockerList blockers={blockers} perspective="admin" />
      </section>

      <section className="mt-8">
        <PropertyActions
          listingId={id}
          stage={stage}
          canSendInvitation={Boolean(listing.hostInvitationId)}
          invitationSent={Boolean(invitation?.sentAt)}
          canSendForReview={listing.reviewStatus === "DRAFT" || listing.reviewStatus === "CHANGES_REQUESTED"}
          canApprove={stage === "awaiting_fystay_review"}
        />
      </section>

      <section className="mt-10" aria-labelledby="history-title">
        <h2 id="history-title" className="text-lg font-semibold text-foreground">
          History
        </h2>
        <ReviewTimeline events={listing.reviewEvents} />
      </section>
    </div>
  );
}
