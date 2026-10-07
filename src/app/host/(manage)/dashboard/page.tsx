import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Award, Sparkles, Wallet } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { averageRating } from "@/lib/reviews";
import {
  computeHostResponseStats,
  GREAT_HOST_MIN_AVERAGE_RATING,
  GREAT_HOST_MIN_COMPLETED_BOOKINGS,
  GREAT_HOST_MIN_RESPONSE_RATE,
  isGreatHost,
} from "@/lib/hostStats";
import {
  addDays,
  bestPastMonth,
  highlights,
  hostRevenueCents,
  isLiveStay,
  listingHealth,
  monthlyEarnings,
  monthRange,
  occupancy,
  percentChange,
  summarizePeriod,
  todayView,
  ukToday,
} from "@/lib/hostInsights";
import { buildActionItems, countReviewsAwaitingReply } from "@/lib/hostAttention";
import { loadHostPortfolio, type PortfolioBooking } from "@/lib/hostData";
import { expireAbandonedCheckouts, expireStaleBookingRequests } from "@/lib/bookingLifecycle";
import { isConnectReady } from "@/lib/stripeConnect";
import { formatDateTime, formatPrice } from "@/lib/format";
import { OnboardingChecklist, type OnboardingStep } from "@/components/host/OnboardingChecklist";
import { ChangeChip, HostPageHeader, Meter, Panel, hostPageClassName } from "@/components/host/HostUi";
import { EarningsBars } from "@/components/host/EarningsBars";
import {
  ActionCentre,
  ComingUp,
  FirstGuestChecklist,
  GlanceTile,
  GreatHostProgress,
  Highlights,
  TodayPanel,
  type StayCard,
} from "@/components/host/TodayPanels";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Today · Hosting", robots: { index: false } };

const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("en-GB", { month: "narrow", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const ukHour = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/London" });

function greeting(now: Date) {
  const hour = Number(ukHour.format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/**
 * The host's home: what's happening today, what needs them, and how the
 * business is doing - in that order, because that's the order a host asks
 * those questions. Every figure comes from src/lib/hostInsights.ts.
 */
export default async function HostTodayPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/host/dashboard");
  if (session.user.role !== "HOST") redirect("/host");
  const hostId = session.user.id;

  await expireStaleBookingRequests(prisma, { hostId });
  await expireAbandonedCheckouts(prisma, { hostId });

  const now = new Date();
  const today = ukToday(now);

  const [{ listings, bookings, reviews }, host, changeRequests, unreadMessages, conversations] = await Promise.all([
    loadHostPortfolio(prisma, hostId),
    prisma.user.findUniqueOrThrow({
      where: { id: hostId },
      select: {
        name: true,
        stripeConnectAccountId: true,
        stripeConnectChargesEnabled: true,
        stripeConnectPayoutsEnabled: true,
        identityVerificationStatus: true,
      },
    }),
    prisma.bookingChangeRequest.count({
      where: { status: "PENDING", booking: { listing: { hostId }, status: "CONFIRMED" } },
    }),
    prisma.message.count({ where: { readAt: null, senderId: { not: hostId }, conversation: { hostId } } }),
    prisma.conversation.findMany({
      where: { hostId, updatedAt: { gte: addDays(now, -365) } },
      select: { hostId: true, guestId: true, messages: { select: { senderId: true, createdAt: true }, take: 20, orderBy: { createdAt: "asc" } } },
    }),
  ]);

  const payoutsReady = isConnectReady(host);
  const onboardingSteps: OnboardingStep[] = [
    {
      key: "listing",
      label: "Create your first listing",
      description: "Add your property's photos, pricing and details to start welcoming guests.",
      href: "/host/listings/new",
      cta: "Create a listing",
      done: listings.length > 0,
    },
    {
      key: "payouts",
      label: "Connect payouts",
      description: "Required before guests can book: set up Stripe so each booking pays you out automatically.",
      href: "/host/payouts",
      cta: host.stripeConnectAccountId ? "Finish onboarding" : "Connect with Stripe",
      done: payoutsReady,
    },
    {
      key: "identity",
      label: "Verify your identity",
      description: "Get an Identity verified badge guests can see on your listings.",
      href: "/account",
      cta: "Verify now",
      done: host.identityVerificationStatus === "VERIFIED",
      optional: true,
    },
  ];

  const firstName = host.name?.split(" ")[0];
  const title = `${greeting(now)}${firstName ? `, ${firstName}` : ""}`;

  if (listings.length === 0) {
    return (
      <div className={hostPageClassName()}>
        <HostPageHeader title={title} subtitle="Welcome to FYStay hosting." />
        <FirstGuestChecklist
          className="mt-6"
          title="Let's get your first place live"
          intro="Three steps and you're taking bookings. You keep your full nightly price - FYStay's fee is added on top for the guest."
          steps={[
            {
              key: "listing",
              label: "Create your listing",
              detail: "Photos, price and house rules - about ten minutes.",
              done: false,
              href: "/host/listings/new",
              cta: "Start",
            },
            {
              key: "payouts",
              label: "Set up payouts",
              detail: "Connect Stripe so each booking pays you automatically.",
              done: payoutsReady,
              href: "/host/payouts",
              cta: "Set up",
            },
            {
              key: "identity",
              label: "Verify your identity",
              detail: "Guests see an Identity verified badge on your listings.",
              done: host.identityVerificationStatus === "VERIFIED",
              href: "/account",
              cta: "Verify",
              optional: true,
            },
          ]}
        />
      </div>
    );
  }

  const titles = new Map(listings.map((l) => [l.id, l.title]));
  const card = (b: PortfolioBooking): StayCard => ({
    id: b.id,
    guestName: b.guestName,
    guests: b.guests,
    nights: b.nights,
    listingTitle: titles.get(b.listingId) ?? "Listing",
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    earningsCents: hostRevenueCents(b),
  });

  // Today
  const t = todayView(listings, bookings, today);
  const upcoming = bookings
    .filter((b) => isLiveStay(b) && b.checkIn > today)
    .sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
  const nextTwoWeeks = upcoming.filter((b) => b.checkIn < addDays(today, 14));

  // This month
  const month = monthRange(today);
  const lastMonth = monthRange(today, -1);
  const thisMonth = summarizePeriod(bookings, month.start, month.end, today);
  const previous = summarizePeriod(bookings, lastMonth.start, lastMonth.end, today);
  const occ = occupancy(listings, bookings, month.start, month.end);
  const occLast = occupancy(listings, bookings, lastMonth.start, lastMonth.end);
  const best = bestPastMonth(bookings, today);
  const series = monthlyEarnings(bookings, today, 12);
  const change = percentChange(thisMonth.earnedCents, previous.earnedCents);

  // Reputation
  const rating = averageRating(reviews);
  const response = computeHostResponseStats(conversations);
  const completedStays = bookings.filter((b) => isLiveStay(b) && b.checkOut <= today).length;

  const health = new Map(listings.map((l) => [l.id, listingHealth(l)]));
  const actions = buildActionItems({
    now,
    payoutsReady,
    hasListings: listings.length > 0,
    requests: bookings
      .filter((b) => b.approvalStatus === "AWAITING" && b.status === "PENDING")
      .map((b) => ({
        id: b.id,
        guestName: b.guestName,
        listingTitle: titles.get(b.listingId) ?? "Listing",
        requestExpiresAt: b.requestExpiresAt,
      })),
    changeRequests,
    depositsToSettle: bookings
      .filter((b) => b.depositStatus === "AUTHORIZED" && b.checkOut <= now)
      .map((b) => ({ bookingId: b.id, guestName: b.guestName, depositClaimDeadline: b.depositClaimDeadline })),
    unreadMessages,
    listings: listings.map((l) => ({ ...l, healthScore: health.get(l.id)?.score ?? 100 })),
    reviewsAwaitingReply: countReviewsAwaitingReply(reviews, now),
    formatDeadline: formatDateTime,
  });

  const wins = highlights({
    thisMonth,
    lastMonthCents: previous.earnedCents,
    best,
    occupancyNow: occ.rate,
    occupancyLastMonth: occLast.rate,
    averageRating: rating,
    reviewCount: reviews.length,
    upcomingStays: upcoming.length,
    formatMoney: formatPrice,
  });

  const greatHost = {
    achieved: isGreatHost({ completedBookings: completedStays, averageRating: rating, responseRate: response.responseRate }),
    criteria: [
      {
        label: "Completed stays",
        current: String(completedStays),
        target: String(GREAT_HOST_MIN_COMPLETED_BOOKINGS),
        progress: (completedStays / GREAT_HOST_MIN_COMPLETED_BOOKINGS) * 100,
        met: completedStays >= GREAT_HOST_MIN_COMPLETED_BOOKINGS,
      },
      {
        label: "Average rating",
        current: rating === null ? "—" : rating.toFixed(1),
        target: GREAT_HOST_MIN_AVERAGE_RATING.toFixed(1),
        progress: rating === null ? 0 : (rating / GREAT_HOST_MIN_AVERAGE_RATING) * 100,
        met: rating !== null && rating >= GREAT_HOST_MIN_AVERAGE_RATING,
      },
      {
        label: "Response rate",
        current: response.responseRate === null ? "—" : `${response.responseRate}%`,
        target: `${GREAT_HOST_MIN_RESPONSE_RATE}%`,
        progress: response.responseRate === null ? 0 : (response.responseRate / GREAT_HOST_MIN_RESPONSE_RATE) * 100,
        met: response.responseRate !== null && response.responseRate >= GREAT_HOST_MIN_RESPONSE_RATE,
      },
    ],
  };

  const summaryLine = [
    t.arrivals.length > 0 && `${t.arrivals.length} arriving`,
    t.departures.length > 0 && `${t.departures.length} leaving`,
    actions.filter((a) => a.tone === "urgent").length > 0 &&
      `${actions.filter((a) => a.tone === "urgent").length} need${actions.filter((a) => a.tone === "urgent").length === 1 ? "s" : ""} you`,
  ]
    .filter(Boolean)
    .join(" · ");

  const bestGap = best && best.earnedCents > thisMonth.earnedCents ? best.earnedCents - thisMonth.earnedCents : null;

  if (bookings.length === 0) {
    const best = [...listings].sort((a, b) => (health.get(b.id)?.score ?? 0) - (health.get(a.id)?.score ?? 0))[0];
    const bestScore = health.get(best.id)?.score ?? 0;
    return (
      <div className={hostPageClassName()}>
        <HostPageHeader title={title} subtitle={longDate.format(today)} />
        <div className="mt-6 grid items-start gap-4 lg:grid-cols-3">
          <FirstGuestChecklist
            className="lg:col-span-2"
            title="Get ready for your first guest"
            intro="When your first booking arrives, this page becomes your daily view: who's arriving, what you've earned and what needs you."
            steps={[
              {
                key: "listing",
                label: "Listing created",
                detail: "",
                done: true,
                href: "/host/listings",
                cta: "",
              },
              {
                key: "payouts",
                label: "Set up payouts",
                detail: "Guests can't book until Stripe is connected - about five minutes.",
                done: payoutsReady,
                href: "/host/payouts",
                cta: host.stripeConnectAccountId ? "Finish" : "Set up",
              },
              {
                key: "live",
                label: "Make it live",
                detail: "Your listing is hidden. Switch it to Live when you're ready.",
                done: listings.some((l) => l.published),
                href: "/host/listings",
                cta: "Publish",
              },
              {
                key: "quality",
                label: "Complete your listing",
                detail: `${best.title} is ${bestScore}% complete. More photos and check-in details help it get booked first.`,
                done: bestScore >= 80,
                href: `/host/listings/${best.id}/edit`,
                cta: "Improve",
              },
              {
                key: "sync",
                label: "Connect your other calendars",
                detail: "Already on Airbnb or Booking.com? Add their calendar link so those dates are blocked here.",
                done: listings.some((l) => l.icalImportUrl),
                href: `/host/listings/${best.id}/calendar`,
                cta: "Connect",
                optional: true,
              },
            ]}
          />
          <ActionCentre items={actions} />
        </div>
      </div>
    );
  }

  return (
    <div className={hostPageClassName()}>
      <HostPageHeader
        title={title}
        subtitle={
          <>
            {longDate.format(today)}
            {summaryLine && <span className="text-stone-500"> · {summaryLine}</span>}
          </>
        }
      />

      <OnboardingChecklist steps={onboardingSteps} />

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-3">
        {/* On a phone the action list comes first; on desktop it sits beside the money. */}
        <ActionCentre items={actions} className="lg:col-start-3 lg:row-start-1" />

        <Panel
          title={`Earned in ${monthName.format(today)}`}
          icon={Wallet}
          action={{ href: "/host/earnings", label: "Earnings" }}
          className="lg:col-span-2 lg:col-start-1 lg:row-start-1"
        >
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <p className="text-5xl font-semibold tracking-tight text-foreground">{formatPrice(thisMonth.earnedCents)}</p>
            <div className="pb-1.5">
              <ChangeChip change={change} comparedTo={monthName.format(lastMonth.start)} positiveOnly />
            </div>
          </div>
          <p className="mt-2 text-sm text-stone-600">
            <span className="font-medium text-foreground">{formatPrice(thisMonth.hostedCents)}</span> from stays so far ·{" "}
            <span className="font-medium text-foreground">{formatPrice(thisMonth.upcomingCents)}</span> still to come ·{" "}
            {thisMonth.bookings} booking{thisMonth.bookings === 1 ? "" : "s"}
          </p>

          {best && (
            <div className="mt-4">
              <Meter
                value={(thisMonth.earnedCents / best.earnedCents) * 100}
                label="Progress towards your best month"
                tone={bestGap === null ? "success" : "accent"}
              />
              <p className="mt-1.5 text-xs text-stone-500">
                {bestGap === null
                  ? `A new record - ahead of ${monthYear.format(best.start)} (${formatPrice(best.earnedCents)}).`
                  : `${formatPrice(bestGap)} to beat your best month, ${monthYear.format(best.start)} (${formatPrice(best.earnedCents)}).`}
              </p>
            </div>
          )}

          <div className="mt-5">
            <EarningsBars
              compact
              caption="Your earnings for each of the last 12 months, by check-in month"
              bars={series.map((p, i) => ({
                label: monthYear.format(p.start),
                shortLabel: monthShort.format(p.start),
                cents: p.earnedCents,
                current: i === series.length - 1,
              }))}
            />
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <TodayPanel
          arrivals={t.arrivals.map(card)}
          departures={t.departures.map(card)}
          inHouse={t.inHouse.map(card)}
          occupiedTonight={t.occupiedTonight}
          bookableListings={t.bookableListings}
          nextArrival={upcoming[0] ? card(upcoming[0]) : null}
        />
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
        <ComingUp stays={nextTwoWeeks.slice(0, 6).map(card)} className="lg:col-span-2" />
        <Panel title="Your standing" icon={Award} className="lg:col-span-1">
          {wins.length > 0 && (
            <div className="mb-4 border-b border-border-subtle pb-4">
              <Highlights items={wins} />
            </div>
          )}
          <GreatHostProgress criteria={greatHost.criteria} achieved={greatHost.achieved} />
        </Panel>
      </div>

      <h2 className="mt-8 text-sm font-semibold text-foreground">{monthName.format(today)} at a glance</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <GlanceTile
          label="Occupancy"
          value={occ.rate === null ? "—" : `${occ.rate}%`}
          meter={occ.rate}
          context={`${occ.bookedNights} of ${occ.availableNights} nights booked`}
        />
        <GlanceTile
          label="Average nightly rate"
          value={thisMonth.averageNightlyCents === null ? "—" : formatPrice(thisMonth.averageNightlyCents)}
          context={
            thisMonth.averageStayNights === null
              ? "No stays yet this month"
              : `Average stay ${thisMonth.averageStayNights} night${thisMonth.averageStayNights === 1 ? "" : "s"}`
          }
        />
        <GlanceTile
          label="Per booking"
          value={thisMonth.averageBookingCents === null ? "—" : formatPrice(thisMonth.averageBookingCents)}
          context={`${thisMonth.bookings} booking${thisMonth.bookings === 1 ? "" : "s"} this month`}
        />
        <GlanceTile
          label="Rating"
          value={rating === null ? "—" : `${rating.toFixed(1)}★`}
          context={
            thisMonth.cancellationRate === null
              ? `${reviews.length} review${reviews.length === 1 ? "" : "s"}`
              : `${reviews.length} review${reviews.length === 1 ? "" : "s"} · ${thisMonth.cancellationRate}% cancelled`
          }
        />
      </div>

      {listings.some((l) => l.published) && upcoming.length === 0 && (
        <Panel className="mt-4" bodyClassName="flex flex-wrap items-center gap-3 py-4">
          <Sparkles className="h-5 w-5 text-accent-600" aria-hidden />
          <p className="flex-1 text-sm text-stone-700">
            No upcoming stays yet. Listings with 5+ photos and a weekly discount tend to get booked first.
          </p>
          <Link href="/host/listings" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Check your listings
          </Link>
        </Panel>
      )}
    </div>
  );
}
