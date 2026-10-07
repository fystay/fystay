import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, ChevronLeft, Eye, ImageOff, MousePointerClick, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hostAcceptsPaidBookings } from "@/lib/stripeConnect";
import {
  liveSpotlightWhere,
  promotionIneligibilityReason,
  promotionPhase,
  SPOTLIGHT_SLOTS,
  type PromotionPhase,
} from "@/lib/listingPromotions";
import { spotlightStatsFor, type SpotlightStats } from "@/lib/spotlightStats";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import { PromoteListingForm } from "@/components/host/PromoteListingForm";
import { formatDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Spotlight", robots: { index: false } };

const PHASE_BADGE: Record<PromotionPhase, { label: string; variant: "success" | "brand" | "neutral" | "warning" }> = {
  live: { label: "Live", variant: "success" },
  scheduled: { label: "Scheduled", variant: "brand" },
  finished: { label: "Finished", variant: "neutral" },
  pending: { label: "Awaiting payment", variant: "warning" },
  cancelled: { label: "Not paid", variant: "neutral" },
};

const formatCount = (n: number) => n.toLocaleString("en-GB");

/**
 * How a listing's Spotlight placements have done: times its stay was shown
 * in the homepage showcase and clicks through to it (src/lib/spotlightStats.ts).
 */
function SpotlightStatsLine({ stats }: { stats: SpotlightStats }) {
  const clickRate = stats.impressions > 0 ? (stats.clicks / stats.impressions) * 100 : null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-600">
      <span className="flex items-center gap-1.5">
        <Eye className="h-4 w-4 text-brand-600" aria-hidden />
        Seen <strong className="font-semibold tabular-nums text-foreground">{formatCount(stats.impressions)}</strong>{" "}
        {stats.impressions === 1 ? "time" : "times"}
      </span>
      <span className="flex items-center gap-1.5">
        <MousePointerClick className="h-4 w-4 text-brand-600" aria-hidden />
        <strong className="font-semibold tabular-nums text-foreground">{formatCount(stats.clicks)}</strong>{" "}
        {stats.clicks === 1 ? "click" : "clicks"} to your listing
        {clickRate !== null && stats.clicks > 0 && (
          <span className="text-stone-500">({clickRate < 10 ? clickRate.toFixed(1) : Math.round(clickRate)}%)</span>
        )}
      </span>
    </p>
  );
}

/**
 * Where a host buys Spotlight placements for their listings (see
 * src/lib/listingPromotions.ts) and sees what they've bought.
 */
export default async function HostPromotePage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; cancelled?: string }>;
}) {
  const { success, cancelled } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/host/promote");
  if (session.user.role !== "HOST") redirect("/host");

  const now = new Date();
  const [host, listings, promotions, liveListingIds] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true },
    }),
    prisma.listing.findMany({
      where: { hostId: session.user.id },
      select: { id: true, title: true, city: true, photos: true, published: true, suspendedAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.listingPromotion.findMany({
      where: { hostId: session.user.id, status: { not: "CANCELLED" } },
      select: {
        id: true,
        listingId: true,
        plan: true,
        days: true,
        priceCents: true,
        status: true,
        startsAt: true,
        endsAt: true,
        paidAt: true,
        createdAt: true,
        listing: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.listingPromotion.findMany({
      where: liveSpotlightWhere(now),
      select: { listingId: true },
      distinct: ["listingId"],
    }),
  ]);

  const stats = await spotlightStatsFor(promotions.filter((p) => p.status === "PAID").map((p) => p.id));
  const statsFor = (ids: string[]): SpotlightStats =>
    ids.reduce(
      (total, id) => {
        const own = stats.get(id);
        return own ? { impressions: total.impressions + own.impressions, clicks: total.clicks + own.clicks } : total;
      },
      { impressions: 0, clicks: 0 },
    );

  const canTakePayments = hostAcceptsPaidBookings(host);
  const spotsFree = Math.max(0, SPOTLIGHT_SLOTS - liveListingIds.length);
  const paidPromotions = promotions.filter((p) => p.status === "PAID");

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link
        href="/host/dashboard"
        className="focus-ring -ml-1 inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-stone-600 hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Spotlight</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-stone-600">
            Feature a listing in <strong className="font-semibold text-foreground">Spotlight stays</strong>, the
            showcase near the top of the FYStay homepage, where each featured stay takes its turn at full size.
            Spots are limited to {SPOTLIGHT_SLOTS} at a time, featured stays are labelled &ldquo;Promoted&rdquo;,
            and you can see how many times yours is seen and clicked.
          </p>
        </div>
        <p className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-stone-700">
          <Sparkles className="h-4 w-4 text-brand-600" aria-hidden />
          <span className="tabular-nums">
            {spotsFree} of {SPOTLIGHT_SLOTS}
          </span>{" "}
          spots free now
        </p>
      </div>

      {success && (
        <Card className="mt-6 border-emerald-200 bg-emerald-50">
          <CardContent className="flex items-start gap-3 pt-5 text-sm text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>
              Payment received - thank you. Your listing appears in Spotlight as soon as Stripe confirms the
              payment, usually within a minute. Refresh this page to see it.
            </p>
          </CardContent>
        </Card>
      )}
      {cancelled && (
        <Card className="mt-6 border-amber-200 bg-amber-50">
          <CardContent className="pt-5 text-sm text-amber-900">
            Payment cancelled - you haven&apos;t been charged.
          </CardContent>
        </Card>
      )}

      {!canTakePayments && listings.length > 0 && (
        <Card className="mt-6 border-amber-200 bg-amber-50">
          <CardContent className="flex flex-col gap-3 pt-5 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
            <p>Finish setting up payouts first, so guests who find a featured listing can book it.</p>
            <Link href="/host/payouts" className={cn(buttonVariants({ size: "sm" }), "shrink-0")}>
              Set up payouts
            </Link>
          </CardContent>
        </Card>
      )}

      {listings.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-3 pt-5 text-sm text-stone-600">
            <p>Create a listing first - then you can feature it here.</p>
            <Link href="/host/listings/new" className={cn(buttonVariants({ size: "sm" }))}>
              Create a listing
            </Link>
          </CardContent>
        </Card>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {listings.map((listing) => {
            const own = paidPromotions.filter((p) => p.listingId === listing.id);
            const live = own.find((p) => promotionPhase(p, now) === "live");
            const upcoming = own
              .filter((p) => promotionPhase(p, now) === "scheduled")
              .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime());
            const featuredUntil = [...own]
              .filter((p) => p.endsAt && p.endsAt > now)
              .reduce<Date | null>((latest, p) => (!latest || p.endsAt! > latest ? p.endsAt! : latest), null);
            const reason = promotionIneligibilityReason(listing, canTakePayments);
            const listingStats = own.length > 0 ? statsFor(own.map((p) => p.id)) : null;

            return (
              <li key={listing.id}>
                <Card>
                  <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row">
                    <div className="h-20 w-full shrink-0 overflow-hidden rounded-xl bg-surface-muted sm:w-28">
                      {listing.photos[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={listing.photos[0]} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-stone-400">
                          <ImageOff className="h-5 w-5" aria-hidden />
                        </div>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{listing.title}</p>
                          <p className="text-sm text-stone-500">{listing.city}</p>
                        </div>
                        {live ? (
                          <Badge variant="success">Live until {formatDate(featuredUntil!)}</Badge>
                        ) : upcoming[0] ? (
                          <Badge variant="brand">Starts {formatDate(upcoming[0].startsAt!)}</Badge>
                        ) : (
                          <Badge variant="neutral">Not featured</Badge>
                        )}
                      </div>
                      {listingStats && <SpotlightStatsLine stats={listingStats} />}
                      {reason ? (
                        <p className="text-sm text-stone-500">{reason}</p>
                      ) : (
                        <PromoteListingForm
                          listingId={listing.id}
                          listingTitle={listing.title}
                          extending={Boolean(featuredUntil)}
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {promotions.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-foreground">Your placements</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-border-subtle bg-surface">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-border-subtle text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Listing</th>
                  <th className="px-4 py-2.5 font-medium">Dates</th>
                  <th className="px-4 py-2.5 font-medium">Price</th>
                  <th className="px-4 py-2.5 text-right font-medium">Views</th>
                  <th className="px-4 py-2.5 text-right font-medium">Clicks</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {promotions.map((promotion) => {
                  const phase = promotionPhase(promotion, now);
                  const badge = PHASE_BADGE[phase];
                  return (
                    <tr key={promotion.id}>
                      <td className="px-4 py-3 font-medium text-foreground">{promotion.listing.title}</td>
                      <td className="px-4 py-3 tabular-nums text-stone-600">
                        {promotion.startsAt && promotion.endsAt
                          ? `${formatDate(promotion.startsAt)} – ${formatDate(promotion.endsAt)}`
                          : `${promotion.days} days`}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-stone-600">{formatPrice(promotion.priceCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-stone-600">
                        {promotion.status === "PAID" ? formatCount(stats.get(promotion.id)?.impressions ?? 0) : "–"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-stone-600">
                        {promotion.status === "PAID" ? formatCount(stats.get(promotion.id)?.clicks ?? 0) : "–"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
