import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { CalendarSearch, Search } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadHostPortfolio } from "@/lib/hostData";
import { hostRevenueCents, ukToday } from "@/lib/hostInsights";
import { hostBookingState, type HostBookingTab } from "@/lib/hostBookingState";
import { expireAbandonedCheckouts, expireStaleBookingRequests } from "@/lib/bookingLifecycle";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/cn";
import { isOptimizableImage } from "@/lib/image";
import { EmptyState, GuestAvatar, HostPageHeader, Pill, hostPageClassName } from "@/components/host/HostUi";

export const metadata: Metadata = { title: "Bookings · Hosting", robots: { index: false } };

const TABS: { key: HostBookingTab; label: string; empty: string }[] = [
  { key: "action", label: "Needs action", empty: "Nothing needs you right now." },
  { key: "current", label: "Today & staying", empty: "Nobody is arriving, leaving or staying today." },
  { key: "upcoming", label: "Upcoming", empty: "No upcoming stays yet." },
  { key: "past", label: "Past", empty: "No completed stays yet." },
  { key: "cancelled", label: "Cancelled", empty: "No cancellations." },
];

const PAGE_SIZE = 40;
const range = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Every booking across the host's listings as cards, not a table: who,
 * where, when and what they'll earn, with the state in plain words. Tabs
 * answer the questions hosts actually ask ("who's coming?", "who's here?",
 * "what do I need to do?"); search and a listing filter cover the rest.
 */
export default async function HostBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; listing?: string; show?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/host/bookings");
  if (session.user.role !== "HOST") redirect("/host");
  const hostId = session.user.id;

  await expireStaleBookingRequests(prisma, { hostId });
  await expireAbandonedCheckouts(prisma, { hostId });

  const params = await searchParams;
  const now = new Date();
  const today = ukToday(now);

  const [{ listings, bookings }, pendingChanges] = await Promise.all([
    loadHostPortfolio(prisma, hostId),
    prisma.bookingChangeRequest.findMany({
      where: { status: "PENDING", booking: { listing: { hostId } } },
      select: { bookingId: true },
    }),
  ]);
  const withChange = new Set(pendingChanges.map((c) => c.bookingId));
  const byId = new Map(listings.map((l) => [l.id, l]));

  const rows = bookings.map((b) => ({
    booking: b,
    listing: byId.get(b.listingId),
    state: hostBookingState(b, today, { hasPendingChange: withChange.has(b.id), now }),
  }));

  const counts = Object.fromEntries(TABS.map((t) => [t.key, rows.filter((r) => r.state.tab === t.key).length])) as Record<
    HostBookingTab,
    number
  >;
  // Land on what matters: anything needing action first, else what's next.
  const tab: HostBookingTab = TABS.some((t) => t.key === params.tab)
    ? (params.tab as HostBookingTab)
    : counts.action > 0
      ? "action"
      : "upcoming";

  const q = params.q?.trim().toLowerCase() ?? "";
  const listingFilter = params.listing && byId.has(params.listing) ? params.listing : "";

  const filtered = rows
    .filter((r) => r.state.tab === tab)
    .filter((r) => !listingFilter || r.booking.listingId === listingFilter)
    .filter(
      (r) =>
        !q ||
        r.booking.guestName.toLowerCase().includes(q) ||
        r.booking.reference.toLowerCase().includes(q) ||
        (r.listing?.title.toLowerCase().includes(q) ?? false),
    )
    // Past and cancelled: most recent first. Everything else: soonest first.
    .sort((a, b) =>
      tab === "past" || tab === "cancelled"
        ? b.booking.checkIn.getTime() - a.booking.checkIn.getTime()
        : a.booking.checkIn.getTime() - b.booking.checkIn.getTime(),
    );

  const shown = filtered.slice(0, PAGE_SIZE * Math.max(1, Number(params.show) || 1));
  const groups: { month: string; items: typeof shown }[] = [];
  for (const row of shown) {
    const month = monthYear.format(row.booking.checkIn);
    const last = groups.at(-1);
    if (last?.month === month) last.items.push(row);
    else groups.push({ month, items: [row] });
  }

  const href = (next: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { tab, q: params.q, listing: listingFilter || undefined, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    return `/host/bookings?${sp.toString()}`;
  };

  const upcomingCount = counts.upcoming + counts.current;
  return (
    <div className={hostPageClassName()}>
      <HostPageHeader
        title="Bookings"
        subtitle={`${upcomingCount} upcoming or in progress · ${counts.past} completed`}
      />

      <nav aria-label="Booking tabs" className="mt-5 flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={href({ tab: t.key, show: undefined })}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "focus-ring flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              t.key === tab ? "bg-foreground text-surface" : "bg-surface text-stone-600 ring-1 ring-border-subtle hover:text-foreground",
            )}
          >
            {t.label}
            {counts[t.key] > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs",
                  t.key === tab
                    ? "bg-surface/20"
                    : t.key === "action"
                      ? "bg-brand-600 text-white"
                      : "bg-surface-muted text-stone-600",
                )}
              >
                {counts[t.key]}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <form action="/host/bookings" className="mt-4 flex flex-wrap gap-2">
        <input type="hidden" name="tab" value={tab} />
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">Search bookings</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Guest, reference or listing"
            className="focus-ring h-10 w-full rounded-xl border border-border-subtle bg-surface pl-9 pr-3 text-sm placeholder:text-stone-400"
          />
        </label>
        {listings.length > 1 && (
          <label className="min-w-0 basis-56">
            <span className="sr-only">Listing</span>
            <select
              name="listing"
              defaultValue={listingFilter}
              className="focus-ring h-10 w-full rounded-xl border border-border-subtle bg-surface px-3 text-sm"
            >
              <option value="">All listings</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="submit"
          className="focus-ring h-10 rounded-xl bg-surface px-4 text-sm font-medium text-foreground ring-1 ring-border-subtle hover:bg-surface-muted"
        >
          Filter
        </button>
      </form>

      {groups.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-border-subtle bg-surface">
          <EmptyState icon={CalendarSearch} title={q || listingFilter ? "No bookings match" : TABS.find((t) => t.key === tab)!.empty}>
            {(q || listingFilter) && (
              <Link href={href({ q: undefined, listing: undefined })} className="font-medium text-brand-700">
                Clear filters
              </Link>
            )}
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.month}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{group.month}</h2>
              <ul className="mt-2 grid gap-2 md:grid-cols-2">
                {group.items.map(({ booking: b, listing, state }) => (
                  <li key={b.id}>
                    <Link
                      href={`/host/bookings/${b.id}`}
                      className="focus-ring group flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface p-3 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
                    >
                      <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                        {listing?.photos[0] ? (
                          <Image
                            src={listing.photos[0]}
                            alt=""
                            fill
                            sizes="56px"
                            unoptimized={!isOptimizableImage(listing.photos[0])}
                            className="object-cover"
                          />
                        ) : (
                          <GuestAvatar name={b.guestName} className="h-full w-full rounded-none" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">{b.guestName}</span>
                          <Pill tone={state.tone}>{state.label}</Pill>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-stone-600">{listing?.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-stone-500">
                          {range.format(b.checkIn)} – {range.format(b.checkOut)} · {b.nights} night
                          {b.nights === 1 ? "" : "s"} · {b.guests} guest{b.guests === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold text-foreground">
                          {formatPrice(hostRevenueCents(b.paymentStatus === "UNPAID" ? { ...b, paymentStatus: "PAID" } : b))}
                        </span>
                        <span className="block text-[11px] text-stone-500">{b.paymentStatus !== "UNPAID" ? "your earnings" : b.status === "PENDING" ? "if accepted" : "due"}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {filtered.length > shown.length && (
            <Link
              href={href({ show: String((Number(params.show) || 1) + 1) })}
              className="focus-ring self-center rounded-full bg-surface px-4 py-2 text-sm font-medium text-foreground ring-1 ring-border-subtle hover:bg-surface-muted"
            >
              Show more ({filtered.length - shown.length})
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
