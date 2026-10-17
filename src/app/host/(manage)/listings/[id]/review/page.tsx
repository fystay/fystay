import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatListingTime, formatQuietHours } from "@/lib/listingTimes";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { StageBadge } from "@/components/onboarding/StageBadge";
import { BlockerList } from "@/components/onboarding/BlockerList";
import { ReviewDecision } from "@/components/onboarding/ReviewDecision";
import { PublishToggle } from "@/components/host/PublishToggle";
import { PUBLICATION_LISTING_SELECT, publicationState } from "@/lib/listingOnboarding";
import { resolveCancellationPolicy } from "@/lib/cancellationPolicy";
import { PROPERTY_TYPE_LABEL } from "@/lib/propertyType";
import { formatDate, formatDateTime, formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Review your listing", robots: { index: false } };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Where a host checks a listing FYStay prepared for them: every material
 * fact in one place, a guest-eye preview, editing, and an explicit
 * approve / ask-for-changes decision. Opening this page approves nothing.
 */
export default async function ReviewListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=/host/listings/${id}/review`);

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: {
      ...PUBLICATION_LISTING_SELECT,
      hostId: true,
      country: true,
      address: true,
      maxGuests: true,
      bedrooms: true,
      beds: true,
      bathrooms: true,
      amenities: true,
      weekendPricePerNightCents: true,
      cleaningFeeCents: true,
      securityDepositCents: true,
      weeklyDiscountPercent: true,
      monthlyDiscountPercent: true,
      lastMinuteDiscountPercent: true,
      lastMinuteWindowDays: true,
      cancellationPolicy: true,
      customCancellationCutoffDays: true,
      customCancellationRefundPercent: true,
      minNights: true,
      maxNights: true,
      instantBook: true,
      checkInTime: true,
      checkOutTime: true,
      selfCheckIn: true,
      smokingAllowed: true,
      partiesAllowed: true,
      quietHoursStart: true,
      quietHoursEnd: true,
      additionalRules: true,
      icalImportUrl: true,
      icalSyncedAt: true,
      approvedAt: true,
      reviewEvents: {
        where: { type: { in: ["SENT_FOR_REVIEW", "CHANGES_REQUESTED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { type: true, note: true, createdAt: true },
      },
    },
  });
  if (!listing) notFound();
  if (listing.hostId !== session.user.id || listing.hostInvitationId) redirect("/host/listings");
  if (!listing.preparedById) redirect(`/host/listings/${id}/edit`);

  const { blockers, stage } = publicationState(listing);
  const latest = listing.reviewEvents[0];
  const canDecide = listing.reviewStatus === "AWAITING_HOST_REVIEW" || listing.reviewStatus === "CHANGES_REQUESTED";
  const policy = resolveCancellationPolicy(listing);

  const status = (() => {
    switch (listing.reviewStatus) {
      case "DRAFT":
        return "FYStay is still preparing this listing. You can look and edit, and we'll ask you to review it when it's ready.";
      case "AWAITING_HOST_REVIEW":
        return "FYStay has prepared this listing for you. Please check everything below - especially anything guests rely on - then approve it or ask for changes.";
      case "CHANGES_REQUESTED":
        return "You asked for changes. FYStay will make them and send it back - or edit it yourself and approve it when it's right.";
      case "HOST_APPROVED":
        return `You approved revision ${listing.approvedRevision} on ${formatDate(listing.approvedAt!)}.${
          listing.approvedRevision !== listing.materialRevision ? ` You've made your own changes since (now revision ${listing.materialRevision}).` : ""
        }`;
      default:
        return "";
    }
  })();

  const facts: [string, string][] = [
    ["Property type", PROPERTY_TYPE_LABEL[listing.propertyType]],
    ["Location", [listing.address, listing.city, listing.country].filter(Boolean).join(", ")],
    [
      "Sleeps",
      [
        plural(listing.maxGuests, "guest"),
        plural(listing.bedrooms, "bedroom"),
        plural(listing.beds, "bed"),
        plural(listing.bathrooms, "bathroom"),
      ].join(" · "),
    ],
    [
      "Nightly price (what you set)",
      listing.pricePerNightCents > 0
        ? `${formatPrice(listing.pricePerNightCents)}${listing.weekendPricePerNightCents !== null ? `, ${formatPrice(listing.weekendPricePerNightCents)} on Friday and Saturday nights` : ""}`
        : "Not set",
    ],
    ["Cleaning fee", listing.cleaningFeeCents > 0 ? formatPrice(listing.cleaningFeeCents) : "None"],
    ["Security deposit", listing.securityDepositCents > 0 ? `${formatPrice(listing.securityDepositCents)} (held, not charged)` : "None"],
    [
      "Discounts",
      [
        listing.weeklyDiscountPercent ? `${listing.weeklyDiscountPercent}% weekly` : null,
        listing.monthlyDiscountPercent ? `${listing.monthlyDiscountPercent}% monthly` : null,
        listing.lastMinuteDiscountPercent ? `${listing.lastMinuteDiscountPercent}% last-minute (within ${listing.lastMinuteWindowDays} days)` : null,
      ]
        .filter(Boolean)
        .join(", ") || "None",
    ],
    ["Stay length", `${listing.minNights} night minimum${listing.maxNights ? `, ${listing.maxNights} maximum` : ""}`],
    ["Booking", listing.instantBook ? "Instant booking - guests book and pay straight away" : "Request to book - you approve each request"],
    ["Cancellation", `${policy.label}: ${policy.description}`],
    ["Check-in / check-out", `${formatListingTime(listing.checkInTime) || "Not set"} / ${formatListingTime(listing.checkOutTime) || "Not set"}${listing.selfCheckIn ? " · self check-in" : ""}`],
    [
      "House rules",
      [
        listing.smokingAllowed ? "Smoking allowed" : "No smoking",
        listing.partiesAllowed ? "Parties allowed" : "No parties",
        listing.quietHoursStart && listing.quietHoursEnd ? `Quiet hours ${formatQuietHours(listing.quietHoursStart, listing.quietHoursEnd)}` : null,
        listing.additionalRules,
      ]
        .filter(Boolean)
        .join(" · "),
    ],
    ["Amenities", listing.amenities.length > 0 ? listing.amenities.join(", ") : "None listed"],
    ["Photos", `${listing.photos.length} photo${listing.photos.length === 1 ? "" : "s"}`],
    [
      "Availability",
      listing.icalImportUrl
        ? `Synced from your other calendar${listing.icalSyncedAt ? ` (last synced ${formatDateTime(listing.icalSyncedAt)})` : ""}`
        : "Managed on FYStay's calendar. If you also take bookings elsewhere (e.g. Airbnb), add that calendar link so dates can't be double-booked.",
    ],
  ];

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link href="/host/listings" className="text-sm font-medium text-brand-700 hover:underline">
        ← Your listings
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Review your listing</h1>
          <p className="mt-1 text-stone-600">{listing.title}</p>
        </div>
        <StageBadge stage={stage} />
      </div>

      <Card className="mt-6 p-5">
        <p className="text-stone-800">{status}</p>
        {latest?.note && (
          <p className="mt-3 whitespace-pre-line rounded-lg bg-surface-muted p-3 text-sm text-stone-700">
            <span className="font-medium">{latest.type === "SENT_FOR_REVIEW" ? "Note from FYStay" : "Your request"}</span>
            {` (${formatDate(latest.createdAt)}): `}
            {latest.note}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/listings/${id}`} className={buttonVariants({ variant: "outline" })}>
            Preview as guests will see it
          </Link>
          <Link href={`/host/listings/${id}/edit`} className={buttonVariants({ variant: "outline" })}>
            Edit details
          </Link>
          <Link href={`/host/listings/${id}/calendar`} className={buttonVariants({ variant: "outline" })}>
            Calendar
          </Link>
        </div>
      </Card>

      <section className="mt-8" aria-labelledby="facts-title">
        <h2 id="facts-title" className="text-lg font-semibold text-foreground">
          What FYStay prepared
        </h2>
        <p className="mt-1 text-sm text-stone-600">Guests book on these details. Check each one is true today.</p>
        <dl className="mt-4 divide-y divide-border-subtle rounded-2xl border border-border-subtle">
          {facts.map(([term, value]) => (
            <div key={term} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[12rem_1fr] sm:gap-4">
              <dt className="font-medium text-stone-500">{term}</dt>
              <dd className="text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {canDecide && (
        <section className="mt-8" aria-labelledby="decision-title">
          <h2 id="decision-title" className="text-lg font-semibold text-foreground">
            Your decision
          </h2>
          <Card className="mt-3 p-5">
            <ReviewDecision listingId={id} revision={listing.materialRevision} />
          </Card>
        </section>
      )}

      <section className="mt-8" aria-labelledby="outstanding-title">
        <h2 id="outstanding-title" className="text-lg font-semibold text-foreground">
          {stage === "live" ? "It's live" : "Before it can go live"}
        </h2>
        {stage === "live" ? (
          <p className="mt-3 text-sm text-stone-700">Guests can find and book it. Use Hidden on your listings page to take it down at any time.</p>
        ) : (
          <BlockerList blockers={blockers} perspective="host" />
        )}
        {stage === "ready_to_publish" && (
          <div className="mt-4 flex items-center gap-3 text-sm text-stone-700">
            <span>Everything&apos;s ready. Switch it on when you want guests to see it:</span>
            <PublishToggle listingId={id} published={false} title={listing.title} />
          </div>
        )}
      </section>
    </div>
  );
}
