import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadHostPortfolio } from "@/lib/hostData";
import { addDays, findCalendarConflicts, isLiveStay, ukToday } from "@/lib/hostInsights";
import { parseStayDate } from "@/lib/stayDates";
import { cn } from "@/lib/cn";
import { HostPageEmpty, HostPageHeader, hostPageClassName } from "@/components/host/HostUi";
import { buttonVariants } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Calendar · Hosting", robots: { index: false } };

const DAYS = 21;
const DAY_MS = 86_400_000;
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "narrow", timeZone: "UTC" });
const monthDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const SOURCE_LABEL = { HOST: "Blocked by you", ICAL_IMPORT: "Booked elsewhere (calendar sync)", PMS_IMPORT: "Booked elsewhere (PMS)" };

/**
 * Every listing on one timeline - the multi-calendar property managers
 * rely on, kept simple: a row per listing, a bar per stay, hatching for
 * dates taken elsewhere or blocked, and the nightly price on free nights.
 * Editing (blocking dates, syncing) stays on each listing's own calendar,
 * one tap away from its row.
 */
export default async function HostCalendarPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/host/calendar");
  if (session.user.role !== "HOST") redirect("/host");
  const hostId = session.user.id;

  const params = await searchParams;
  const today = ukToday();
  const start = (params.start && parseStayDate(params.start)) || addDays(today, -1);
  const end = addDays(start, DAYS);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));

  const [{ listings, bookings }, blocks] = await Promise.all([
    loadHostPortfolio(prisma, hostId),
    prisma.availabilityBlock.findMany({
      where: { listing: { hostId } },
      select: { id: true, listingId: true, roomTypeId: true, startDate: true, endDate: true, source: true },
    }),
  ]);

  if (listings.length === 0) {
    return (
      <div className={hostPageClassName()}>
        <HostPageHeader title="Calendar" />
        <HostPageEmpty
          icon={CalendarDays}
          title="All your properties, on one calendar"
          action={{ href: "/host/listings/new", label: "Create your first listing" }}
        >
          See every stay, request and blocked date across your listings at a glance - and connect your Airbnb or
          other calendars so dates booked elsewhere are blocked here automatically.
        </HostPageEmpty>
      </div>
    );
  }

  const conflicts = findCalendarConflicts(listings, bookings, blocks);
  const conflictBookings = new Set(conflicts.map((c) => c.bookingId));
  const live = bookings.filter(
    (b) => (isLiveStay(b) || (b.approvalStatus === "AWAITING" && b.status === "PENDING")) && b.checkIn < end && b.checkOut > start,
  );
  const visibleBlocks = blocks.filter((b) => b.startDate < end && b.endDate > start);

  const col = (date: Date) => Math.max(0, Math.round((date.getTime() - start.getTime()) / DAY_MS));
  const shift = (n: number) => `/host/calendar?start=${addDays(start, n).toISOString().slice(0, 10)}`;
  const gridTemplate = { gridTemplateColumns: `minmax(9rem, 12rem) repeat(${DAYS}, minmax(2.5rem, 1fr))` };

  return (
    <div className={hostPageClassName()}>
      <HostPageHeader
        title="Calendar"
        subtitle={`${monthDay.format(start)} – ${monthDay.format(addDays(end, -1))} · all ${listings.length} listing${listings.length === 1 ? "" : "s"}`}
      >
        <Link href={shift(-14)} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label="Two weeks earlier">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <Link href="/host/calendar" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Today
        </Link>
        <Link href={shift(14)} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label="Two weeks later">
          <ChevronRight className="h-4 w-4" />
        </Link>
      </HostPageHeader>

      {conflicts.length > 0 && (
        <div role="alert" className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            <strong className="font-semibold">
              {conflicts.length} possible double booking{conflicts.length === 1 ? "" : "s"}.
            </strong>{" "}
            A FYStay stay overlaps dates another site has marked as booked. Check the other site and contact the guest
            straight away -{" "}
            {conflicts.slice(0, 3).map((c, i) => (
              <span key={c.blockId + c.bookingId}>
                {i > 0 && ", "}
                <Link href={`/host/bookings/${c.bookingId}`} className="font-semibold underline">
                  {listings.find((l) => l.id === c.listingId)?.title} ({monthDay.format(c.from)})
                </Link>
              </span>
            ))}
            .
          </p>
        </div>
      )}

      <Legend />

      <div className="mt-3 overflow-x-auto rounded-2xl border border-border-subtle bg-surface shadow-[var(--shadow-card)]">
        <div className="min-w-[60rem]">
          {/* Day header */}
          <div className="grid border-b border-border-subtle" style={gridTemplate}>
            <div className="sticky left-0 z-10 bg-surface" />
            {days.map((d) => {
              const isToday = d.getTime() === today.getTime();
              const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
              return (
                <div
                  key={d.toISOString()}
                  className={cn("py-2 text-center", weekend && "bg-surface-muted/50", isToday && "bg-brand-50")}
                >
                  <div className="text-[10px] font-medium uppercase text-stone-500">{weekday.format(d)}</div>
                  <div className={cn("text-sm font-semibold", isToday ? "text-brand-700" : "text-foreground")}>
                    {d.getUTCDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {listings.map((listing) => {
            const rowBookings = live.filter((b) => b.listingId === listing.id);
            const rowBlocks = visibleBlocks.filter((b) => b.listingId === listing.id);
            const multiUnit = listing.units > 1;
            return (
              <div key={listing.id} className="grid border-b border-border-subtle last:border-b-0" style={gridTemplate}>
                <Link
                  href={`/host/listings/${listing.id}/calendar`}
                  className="focus-ring sticky left-0 z-10 flex min-w-0 flex-col justify-center border-r border-border-subtle bg-surface px-3 py-2 hover:bg-surface-muted/60"
                  style={{ gridRow: 1, gridColumn: 1 }}
                >
                  <span className="truncate text-xs font-semibold text-foreground">{listing.title}</span>
                  <span className="text-[11px] text-stone-500">
                    {listing.published ? listing.city : "Hidden"}
                    {multiUnit && ` · ${listing.units} rooms`}
                  </span>
                </Link>

                {/* Free nights carry the price; weekends and today are shaded. */}
                {days.map((d, i) => {
                  const isToday = d.getTime() === today.getTime();
                  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
                  const booked = multiUnit
                    ? rowBookings.filter((b) => b.checkIn <= d && b.checkOut > d).reduce((s, b) => s + b.roomsBooked, 0)
                    : 0;
                  return (
                    <div
                      key={d.toISOString()}
                      className={cn(
                        "flex min-h-12 items-end justify-center pb-1 text-[10px] text-stone-400",
                        weekend && "bg-surface-muted/40",
                        isToday && "bg-brand-50/70",
                      )}
                      style={{ gridRow: 1, gridColumn: i + 2 }}
                    >
                      {multiUnit
                        ? booked > 0 && (
                            <span className="mb-2 rounded-md bg-brand-100 px-1 font-semibold text-brand-800">
                              {booked}/{listing.units}
                            </span>
                          )
                        : `£${Math.round(listing.pricePerNightCents / 100)}`}
                    </div>
                  );
                })}

                {!multiUnit &&
                  rowBlocks.map((block) => (
                    <div
                      key={block.id}
                      title={SOURCE_LABEL[block.source]}
                      className={cn(
                        "z-[1] m-1 flex items-center overflow-hidden rounded-lg bg-surface px-2 text-[11px] font-medium",
                        block.source === "HOST"
                          ? "bg-[repeating-linear-gradient(135deg,var(--surface-muted)_0_6px,transparent_6px_12px)] text-stone-600 ring-1 ring-inset ring-border-subtle"
                          : "bg-[repeating-linear-gradient(135deg,#e0f2fe_0_6px,transparent_6px_12px)] text-sky-900 ring-1 ring-inset ring-sky-200",
                      )}
                      style={{
                        gridRow: 1,
                        gridColumn: `${col(block.startDate) + 2} / span ${Math.max(1, col(block.endDate) - col(block.startDate))}`,
                      }}
                    >
                      <span className="truncate">{block.source === "HOST" ? "Blocked" : "Elsewhere"}</span>
                    </div>
                  ))}

                {!multiUnit &&
                  rowBookings.map((b) => {
                    const from = col(b.checkIn);
                    const span = Math.max(1, col(b.checkOut) - from);
                    const request = b.status === "PENDING";
                    const conflict = conflictBookings.has(b.id);
                    return (
                      <Link
                        key={b.id}
                        href={`/host/bookings/${b.id}`}
                        title={`${b.guestName} · ${monthDay.format(b.checkIn)} – ${monthDay.format(b.checkOut)}`}
                        className={cn(
                          "focus-ring z-[1] m-1 flex items-center gap-1 overflow-hidden rounded-lg px-2 text-[11px] font-semibold",
                          request
                            ? "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-300"
                            : "bg-brand-600 text-white hover:bg-brand-700",
                          conflict && "ring-2 ring-red-500",
                          b.checkIn < start && "rounded-l-none",
                        )}
                        style={{ gridRow: 1, gridColumn: `${from + 2} / span ${Math.min(span, DAYS - from)}` }}
                      >
                        {conflict && <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />}
                        <span className="truncate">
                          {request ? `Request · ${b.guestName}` : b.guestName}
                        </span>
                      </Link>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs text-stone-500">
        Tap a listing to block dates, sync another calendar, or see it month by month. Tap a stay for its details.
      </p>
    </div>
  );
}

function Legend() {
  const item = (swatch: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-3 w-5 rounded", swatch)} aria-hidden />
      {label}
    </span>
  );
  return (
    <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
      {item("bg-brand-600", "Booked on FYStay")}
      {item("bg-amber-50 ring-1 ring-inset ring-amber-300", "Request")}
      {item("bg-[repeating-linear-gradient(135deg,#e0f2fe_0_3px,transparent_3px_6px)] ring-1 ring-inset ring-sky-200", "Booked elsewhere (synced)")}
      {item("bg-[repeating-linear-gradient(135deg,var(--surface-muted)_0_3px,transparent_3px_6px)] ring-1 ring-inset ring-border-subtle", "Blocked by you")}
    </div>
  );
}
