import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { CalendarDays, CheckCircle2, Circle, Eye, Home, ImageOff, PencilLine, PlusCircle, Star } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadHostPortfolio, type PortfolioListing } from "@/lib/hostData";
import { listingHealth, listingPerformance, monthRange, ukToday } from "@/lib/hostInsights";
import { averageRating } from "@/lib/reviews";
import { hostAcceptsPaidBookings } from "@/lib/stripeConnect";
import { formatPrice } from "@/lib/format";
import { isOptimizableImage } from "@/lib/image";
import { cn } from "@/lib/cn";
import { HostPageEmpty, HostPageHeader, Meter, Pill, hostPageClassName } from "@/components/host/HostUi";
import { PublishToggle } from "@/components/host/PublishToggle";
import { DeleteListingButton } from "@/components/DeleteListingButton";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Listings · Hosting", robots: { index: false } };

/**
 * Every listing as a card that says how it's doing (this month's earnings
 * and occupancy, rating) and how complete it is - the checklist turns
 * "improve your listing" into specific, ticked-off steps.
 */
export default async function HostListingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/host/listings");
  if (session.user.role !== "HOST") redirect("/host");
  const hostId = session.user.id;

  const [{ listings, bookings, reviews }, host] = await Promise.all([
    loadHostPortfolio(prisma, hostId),
    prisma.user.findUniqueOrThrow({
      where: { id: hostId },
      select: { stripeConnectAccountId: true, stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true },
    }),
  ]);

  const today = ukToday();
  const month = monthRange(today);
  const perf = new Map(listingPerformance(listings, bookings, month.start, month.end, today).map((p) => [p.listingId, p]));
  const canTakeBookings = hostAcceptsPaidBookings(host);
  const avgHealth = listings.length
    ? Math.round(listings.reduce((s, l) => s + listingHealth(l).score, 0) / listings.length)
    : 0;

  return (
    <div className={hostPageClassName()}>
      <HostPageHeader
        title="Listings"
        subtitle={
          listings.length === 0
            ? "You haven't listed a place yet."
            : `${listings.filter((l) => l.published).length} live of ${listings.length} · ${avgHealth}% complete on average`
        }
      >
        <Link href="/host/listings/new" className={buttonVariants()}>
          <PlusCircle className="h-4 w-4" />
          New listing
        </Link>
      </HostPageHeader>

      {!canTakeBookings && listings.length > 0 && (
        <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
          <p>
            <strong className="font-semibold">Guests can&apos;t book yet.</strong> Live listings appear in search once your
            Stripe payouts are set up.
          </p>
          <Link href="/host/payouts" className={cn(buttonVariants({ size: "sm" }), "shrink-0")}>
            Set up payouts
          </Link>
        </div>
      )}

      {listings.length === 0 && (
        <HostPageEmpty
          icon={Home}
          title="Let's get your first place listed"
          action={{ href: "/host/listings/new", label: "Create a listing" }}
          secondary={{ href: "/host-guide", label: "Read the host guide" }}
        >
          Add a few photos, your nightly price and your house rules - about ten minutes. You keep your full price:
          FYStay&apos;s fee is added on top for the guest, and you decide when it goes live.
        </HostPageEmpty>
      )}

      <ul className="mt-6 grid gap-4 lg:grid-cols-2">
        {listings.map((listing) => (
          <li key={listing.id}>
            <ListingCard
              listing={listing}
              earnedCents={perf.get(listing.id)?.earnedCents ?? 0}
              occupancyRate={perf.get(listing.id)?.occupancyRate ?? null}
              rating={averageRating(reviews.filter((r) => r.listingId === listing.id))}
              reviewCount={reviews.filter((r) => r.listingId === listing.id).length}
              monthLabel={month.start.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })}
              canTakeBookings={canTakeBookings}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ListingCard({
  listing,
  earnedCents,
  occupancyRate,
  rating,
  reviewCount,
  monthLabel,
  canTakeBookings,
}: {
  listing: PortfolioListing;
  earnedCents: number;
  occupancyRate: number | null;
  rating: number | null;
  reviewCount: number;
  monthLabel: string;
  canTakeBookings: boolean;
}) {
  const health = listingHealth(listing);
  const todo = health.items.filter((i) => !i.done);
  const status = listing.suspendedAt
    ? { label: "Paused by FYStay", tone: "danger" as const }
    : !listing.published
      ? { label: "Hidden", tone: "neutral" as const }
      : canTakeBookings
        ? { label: "Live", tone: "success" as const }
        : { label: "Not bookable yet", tone: "warning" as const };

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-[var(--shadow-card)]">
      <div className="flex gap-4 p-4">
        <div className="relative h-24 w-28 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
          {listing.photos[0] ? (
            <Image
              src={listing.photos[0]}
              alt=""
              fill
              sizes="112px"
              unoptimized={!isOptimizableImage(listing.photos[0])}
              className="object-cover"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-stone-400">
              <ImageOff className="h-5 w-5" aria-hidden />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="line-clamp-2 text-sm font-semibold text-foreground">{listing.title}</h2>
            <Pill tone={status.tone}>{status.label}</Pill>
          </div>
          <p className="mt-0.5 text-xs text-stone-500">
            {listing.city} · {formatPrice(listing.pricePerNightCents)} a night
            {rating !== null && (
              <>
                {" · "}
                <Star className="inline h-3 w-3 fill-current text-accent-500" aria-hidden /> {rating.toFixed(1)} ({reviewCount})
              </>
            )}
          </p>
          <dl className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-stone-500">{monthLabel}</dt>
              <dd className="text-sm font-semibold text-foreground">{formatPrice(earnedCents)}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Occupancy</dt>
              <dd className="text-sm font-semibold text-foreground">{occupancyRate === null ? "—" : `${occupancyRate}%`}</dd>
            </div>
          </dl>
        </div>
      </div>

      <details className="group border-t border-border-subtle px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-3 text-xs [&::-webkit-details-marker]:hidden">
          <span className="font-medium text-foreground">Listing {health.score}% complete</span>
          <Meter
            value={health.score}
            label={`${listing.title} completeness`}
            tone={health.score === 100 ? "success" : "brand"}
            className="max-w-40 flex-1"
          />
          <span className="ml-auto text-brand-700 group-open:hidden">
            {todo.length === 0 ? "All done" : `${todo.length} to do`}
          </span>
        </summary>
        <ul className="mt-3 flex flex-col gap-2">
          {health.items.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-xs">
              {item.done ? (
                <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              ) : (
                <Circle className="mt-px h-4 w-4 shrink-0 text-stone-300" aria-hidden />
              )}
              <span>
                <span className={cn("font-medium", item.done ? "text-stone-500" : "text-foreground")}>{item.label}</span>
                {!item.done && <span className="block text-stone-500">{item.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
        {todo.length > 0 && (
          <Link href={`/host/listings/${listing.id}/edit`} className={cn(buttonVariants({ size: "sm" }), "mt-3")}>
            Finish your listing
          </Link>
        )}
      </details>

      <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-border-subtle px-3 py-2">
        {!listing.suspendedAt && <PublishToggle listingId={listing.id} published={listing.published} title={listing.title} />}
        <span className="ml-auto flex flex-wrap items-center gap-0.5">
          <ActionLink href={`/host/listings/${listing.id}/edit`} icon={PencilLine} label="Edit" />
          <ActionLink href={`/host/listings/${listing.id}/calendar`} icon={CalendarDays} label="Calendar" />
          <ActionLink href={`/host/listings/${listing.id}/reviews`} icon={Star} label="Reviews" />
          <ActionLink href={`/listings/${listing.id}`} icon={Eye} label="View" />
          <DeleteListingButton listingId={listing.id} listingTitle={listing.title} />
        </span>
      </div>
    </article>
  );
}

function ActionLink({ href, icon: Icon, label }: { href: string; icon: typeof Eye; label: string }) {
  return (
    <Link
      href={href}
      className="focus-ring flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-stone-600 hover:bg-surface-muted hover:text-foreground"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
}
