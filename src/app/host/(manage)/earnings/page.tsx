import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Banknote, CircleDollarSign, ExternalLink, Home, ReceiptText } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadHostPortfolio } from "@/lib/hostData";
import {
  earningsPeriod,
  hostRevenueCents,
  listingPerformance,
  monthlyEarnings,
  occupancy,
  percentChange,
  summarizePeriod,
  ukToday,
} from "@/lib/hostInsights";
import { getHostStripeBalance } from "@/lib/hostBalance";
import { isConnectReady } from "@/lib/stripeConnect";
import { parseStayDate } from "@/lib/stayDates";
import { formatPrice, formatStayDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EarningsBars } from "@/components/host/EarningsBars";
import { ChangeChip, EmptyState, HostPageHeader, Meter, Panel, hostPageClassName } from "@/components/host/HostUi";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Earnings · Hosting", robots: { index: false } };

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "year", label: "This year" },
  { key: "custom", label: "Custom" },
] as const;

const monthYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("en-GB", { month: "narrow", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * "How much have I made?" and "how much am I going to receive?", answered
 * at the top in two numbers, then explained: what the figure is made of,
 * how it trends, which listings earned it, and the stays behind it.
 */
export default async function HostEarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; show?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/host/earnings");
  if (session.user.role !== "HOST") redirect("/host");
  const hostId = session.user.id;

  const params = await searchParams;
  const today = ukToday();
  const period = earningsPeriod(
    params.period,
    today,
    params.from ? parseStayDate(params.from) : null,
    params.to ? parseStayDate(params.to) : null,
  );

  const [{ listings, bookings }, host] = await Promise.all([
    loadHostPortfolio(prisma, hostId),
    prisma.user.findUniqueOrThrow({
      where: { id: hostId },
      select: { stripeConnectAccountId: true, stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true },
    }),
  ]);
  const balance = await getHostStripeBalance(host.stripeConnectAccountId);

  const summary = summarizePeriod(bookings, period.start, period.end, today);
  const previous = period.previous ? summarizePeriod(bookings, period.previous.start, period.previous.end, today) : null;
  const occ = occupancy(listings, bookings, period.start, period.end);
  const allTime = bookings.reduce((sum, b) => sum + hostRevenueCents(b), 0);
  const upcomingAll = bookings
    .filter((b) => (b.status === "CONFIRMED" || b.status === "COMPLETED") && b.checkIn > today)
    .reduce((sum, b) => sum + hostRevenueCents(b), 0);

  const series = monthlyEarnings(bookings, today, 12);
  const perListing = listingPerformance(listings, bookings, period.start, period.end, today)
    .filter((p) => p.earnedCents > 0 || p.bookings > 0)
    .sort((a, b) => b.earnedCents - a.earnedCents);
  const topEarned = perListing[0]?.earnedCents ?? 0;
  const titles = new Map(listings.map((l) => [l.id, l.title]));

  const stays = bookings
    .filter((b) => b.paymentStatus !== "UNPAID" && b.checkIn >= period.start && b.checkIn < period.end)
    .sort((a, b) => b.checkIn.getTime() - a.checkIn.getTime());
  const shownStays = stays.slice(0, 25 * Math.max(1, Number(params.show) || 1));

  const periodHref = (key: string) => `/host/earnings?period=${key}`;
  const rangeText =
    period.key === "today"
      ? dayMonth.format(period.start)
      : `${formatStayDate(period.start)} – ${formatStayDate(new Date(period.end.getTime() - 86_400_000))}`;

  return (
    <div className={hostPageClassName()}>
      <HostPageHeader title="Earnings" subtitle="Your share of each stay, counted by its check-in date." />

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <MoneyStat label="All-time earnings" value={formatPrice(allTime)} note="Across every stay on FYStay" />
        <MoneyStat label="Booked and still to come" value={formatPrice(upcomingAll)} note="Future stays already paid for" />
        {balance ? (
          <MoneyStat
            label="In your Stripe account"
            value={formatPrice(balance.availableCents + balance.pendingCents)}
            note={`${formatPrice(balance.availableCents)} ready to pay out · ${formatPrice(balance.pendingCents)} settling`}
          />
        ) : (
          <MoneyStat
            label="In your Stripe account"
            value="—"
            note={isConnectReady(host) ? "Stripe couldn't be reached just now" : "Connect Stripe to get paid"}
            href={isConnectReady(host) ? undefined : "/host/payouts"}
          />
        )}
      </div>

      <nav aria-label="Period" className="mt-6 flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={periodHref(p.key)}
            aria-current={period.key === p.key ? "page" : undefined}
            className={cn(
              "focus-ring shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium",
              period.key === p.key
                ? "bg-foreground text-surface"
                : "bg-surface text-stone-600 ring-1 ring-border-subtle hover:text-foreground",
            )}
          >
            {p.label}
          </Link>
        ))}
      </nav>
      {(params.period === "custom" || period.key === "custom") && (
        <form action="/host/earnings" className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value="custom" />
          <label className="text-xs text-stone-600">
            From
            <input
              type="date"
              name="from"
              defaultValue={params.from ?? isoDate(period.start)}
              className="focus-ring mt-1 block h-10 rounded-xl border border-border-subtle bg-surface px-3 text-sm"
            />
          </label>
          <label className="text-xs text-stone-600">
            To
            <input
              type="date"
              name="to"
              defaultValue={params.to ?? isoDate(new Date(period.end.getTime() - 86_400_000))}
              className="focus-ring mt-1 block h-10 rounded-xl border border-border-subtle bg-surface px-3 text-sm"
            />
          </label>
          <button type="submit" className={buttonVariants({ variant: "outline" })}>
            Show
          </button>
        </form>
      )}

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
        <Panel title={`Earned · ${period.label}`} icon={CircleDollarSign} className="lg:col-span-2">
          <p className="text-xs text-stone-500">{rangeText}</p>
          <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-2">
            <p className="text-5xl font-semibold tracking-tight text-foreground">{formatPrice(summary.earnedCents)}</p>
            {previous && period.previous && (
              <div className="pb-1.5">
                <ChangeChip
                  change={percentChange(summary.earnedCents, previous.earnedCents)}
                  comparedTo={period.previous.label}
                  positiveOnly={period.start <= today && period.end > today}
                />
              </div>
            )}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Bookings" value={String(summary.bookings)} />
            <Fact label="Nights" value={String(summary.nights)} />
            <Fact
              label="Avg nightly rate"
              value={summary.averageNightlyCents === null ? "—" : formatPrice(summary.averageNightlyCents)}
            />
            <Fact label="Occupancy" value={occ.rate === null ? "—" : `${occ.rate}%`} />
          </dl>
          {summary.upcomingCents > 0 && (
            <p className="mt-4 rounded-xl bg-surface-muted/70 px-3 py-2 text-sm text-stone-700">
              <span className="font-semibold text-foreground">{formatPrice(summary.hostedCents)}</span> from stays that
              have started, <span className="font-semibold text-foreground">{formatPrice(summary.upcomingCents)}</span>{" "}
              from stays still to come.
            </p>
          )}
        </Panel>

        <Panel title="Where it comes from" icon={ReceiptText}>
          <dl className="flex flex-col gap-2 text-sm">
            <Line label="Guests paid" value={summary.guestPaidCents} />
            <Line label="FYStay service fee" value={-summary.fystayFeeCents} note="charged to guests" />
            <Line label="Card processing" value={0} note="FYStay covers it" />
            {summary.refundedCents > 0 && <Line label="Refunded to guests" value={-summary.refundedCents} />}
            <div className="mt-1 border-t border-border-subtle pt-2">
              <Line label="Your earnings" value={summary.earnedCents} strong />
            </div>
          </dl>
          <p className="mt-3 text-xs text-stone-500">
            You keep your full nightly rate and cleaning fee. FYStay&apos;s fee is added on top for the guest.
          </p>
        </Panel>
      </div>

      <Panel title="Last 12 months" className="mt-4">
        <EarningsBars
          caption="Your earnings for each of the last 12 months, by check-in month"
          bars={series.map((p, i) => ({
            label: monthYear.format(p.start),
            shortLabel: monthShort.format(p.start),
            cents: p.earnedCents,
            current: i === series.length - 1,
          }))}
        />
      </Panel>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <Panel title="By listing" icon={Home}>
          {perListing.length === 0 ? (
            <EmptyState icon={Home} title="No stays in this period" className="py-4" />
          ) : (
            <ul className="flex flex-col gap-3">
              {perListing.slice(0, 8).map((p, i) => (
                <li key={p.listingId}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-foreground">
                      {i === 0 && perListing.length > 1 && (
                        <span className="mr-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
                          Top
                        </span>
                      )}
                      {titles.get(p.listingId)}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">{formatPrice(p.earnedCents)}</span>
                  </div>
                  <Meter value={topEarned > 0 ? (p.earnedCents / topEarned) * 100 : 0} label={`${titles.get(p.listingId)} earnings`} className="mt-1.5" />
                  <p className="mt-1 text-xs text-stone-500">
                    {p.bookings} booking{p.bookings === 1 ? "" : "s"}
                    {p.occupancyRate !== null && ` · ${p.occupancyRate}% occupied`}
                  </p>
                </li>
              ))}
              {perListing.length > 8 && (
                <li className="text-xs text-stone-500">and {perListing.length - 8} more listings</li>
              )}
            </ul>
          )}
        </Panel>

        <Panel title="Stays in this period" icon={Banknote}>
          {stays.length === 0 ? (
            <EmptyState icon={Banknote} title="No paid stays in this period" className="py-4" />
          ) : (
            <ul className="-mx-2 flex flex-col">
              {shownStays.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/host/bookings/${b.id}`}
                    className="focus-ring flex items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-surface-muted/60"
                  >
                    <span className="w-14 shrink-0 text-xs tabular-nums text-stone-500">{dayMonth.format(b.checkIn)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{b.guestName}</span>
                      <span className="block truncate text-xs text-stone-500">
                        {titles.get(b.listingId)} · {b.nights} night{b.nights === 1 ? "" : "s"}
                        {b.status === "CANCELLED" && " · cancelled"}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">{formatPrice(hostRevenueCents(b))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {stays.length > shownStays.length && (
            <Link
              href={`/host/earnings?${new URLSearchParams({ ...params, show: String((Number(params.show) || 1) + 1) } as Record<string, string>)}`}
              className="mt-2 inline-block text-sm font-medium text-brand-700"
            >
              Show more ({stays.length - shownStays.length})
            </Link>
          )}
        </Panel>
      </div>

      <Panel className="mt-4" bodyClassName="flex flex-wrap items-center gap-3 py-4">
        <p className="flex-1 text-sm text-stone-600">
          Stripe sends money in your account to your bank on your payout schedule. Statements, payout dates and tax
          documents are in your Stripe dashboard.
        </p>
        {host.stripeConnectAccountId && (
          <a href="/api/host/stripe/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Open Stripe
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </Panel>
    </div>
  );
}

function MoneyStat({ label, value, note, href }: { label: string; value: string; note: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs text-stone-500">{note}</p>
    </>
  );
  const cls = "min-w-0 rounded-2xl border border-border-subtle bg-surface p-4 shadow-[var(--shadow-card)]";
  return href ? (
    <Link href={href} className={cn(cls, "focus-ring hover:shadow-[var(--shadow-card-hover)]")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-muted/60 px-3 py-2">
      <dt className="text-[11px] font-medium text-stone-500">{label}</dt>
      <dd className="text-lg font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function Line({ label, value, note, strong }: { label: string; value: number; note?: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong ? "font-semibold text-foreground" : "text-stone-600")}>
      <dt>
        {label}
        {note && <span className="ml-1 text-xs text-stone-400">({note})</span>}
      </dt>
      <dd className="tabular-nums text-foreground">{value < 0 ? `−${formatPrice(-value)}` : formatPrice(value)}</dd>
    </div>
  );
}
