import type { Metadata } from "next";
import { bookingNightlySubtotalCents, nightlyChargeLines } from "@/lib/pricing";
import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CircleDollarSign,
  Clock,
  LifeBuoy,
  Mail,
  MessageCircle,
  Phone,
  ShieldCheck,
  Users,
} from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hostPayoutCents, hostRevenueCents, ukToday } from "@/lib/hostInsights";
import { hostBookingState } from "@/lib/hostBookingState";
import { formatDateTime, formatPrice, formatStayDate } from "@/lib/format";
import { isOptimizableImage } from "@/lib/image";
import { BookingRequestActions } from "@/components/BookingRequestActions";
import { ChangeRequestActions } from "@/components/ChangeRequestActions";
import { SecurityDeposits } from "@/components/host/SecurityDeposits";
import { GuestAvatar, Panel, Pill } from "@/components/host/HostUi";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Booking · Hosting", robots: { index: false } };

const longDay = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/**
 * One booking, from the host's side: who, when, what they'll earn and how
 * that figure is made up, and every action the booking allows - all on
 * one page, instead of scattered across the dashboard as before.
 */
export default async function HostBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=/host/bookings/${id}`);

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      listing: { select: { id: true, title: true, city: true, hostId: true, photos: true, checkInTime: true, checkOutTime: true } },
      changeRequests: { orderBy: { createdAt: "desc" } },
    },
  });
  // Another host's booking is indistinguishable from a missing one.
  if (!booking || booking.listing.hostId !== session.user.id) notFound();

  const conversation = await prisma.conversation.findUnique({
    where: { listingId_guestId: { listingId: booking.listingId, guestId: booking.guestId } },
    select: { id: true },
  });

  const now = new Date();
  const today = ukToday(now);
  const pendingChange = booking.changeRequests.find((c) => c.status === "PENDING");
  const state = hostBookingState(booking, today, { hasPendingChange: Boolean(pendingChange), now });
  const isRequest = booking.approvalStatus === "AWAITING" && booking.status === "PENDING";
  const confirmed = booking.status === "CONFIRMED" || booking.status === "COMPLETED";

  const gross = hostPayoutCents(booking);
  const net = booking.paidAt ? hostRevenueCents(booking) : gross;
  const fystayFee = booking.totalPriceCents - gross;
  const refunded = booking.refundedAmountCents ?? 0;
  const roomCents = bookingNightlySubtotalCents(booking) - booking.lengthOfStayDiscountCents;

  const timeline = [
    { at: booking.createdAt, label: isRequest ? "Request sent" : "Booked" },
    booking.hostRespondedAt && {
      at: booking.hostRespondedAt,
      label: booking.approvalStatus === "DECLINED" ? "You declined the request" : "You accepted the request",
    },
    booking.paidAt && { at: booking.paidAt, label: `Guest paid ${formatPrice(booking.totalPriceCents)}` },
    ...booking.changeRequests
      .filter((c) => c.respondedAt)
      .map((c) => ({ at: c.respondedAt!, label: `Date change ${c.status.toLowerCase()}` })),
    booking.refundedAt && { at: booking.refundedAt, label: `Refunded ${formatPrice(refunded)} to the guest` },
    booking.depositCapturedAt && {
      at: booking.depositCapturedAt,
      label: `Deposit claim of ${formatPrice(booking.depositCapturedCents ?? 0)}${booking.depositTransferredAt ? " paid to you" : ""}`,
    },
    booking.depositReleasedAt && { at: booking.depositReleasedAt, label: "Deposit hold released" },
  ]
    .filter((e): e is { at: Date; label: string } => Boolean(e))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/host/bookings"
        className="focus-ring inline-flex items-center gap-1 rounded-md text-sm font-medium text-stone-600 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Bookings
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <GuestAvatar name={booking.guestName ?? "Guest"} className="h-12 w-12 text-sm" />
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-3xl leading-tight text-foreground">{booking.guestName ?? "Guest"}</h1>
          <p className="text-sm text-stone-500">
            {booking.listing.title} · Ref {booking.reference}
          </p>
        </div>
        <Pill tone={state.tone} className="text-sm">
          {state.label}
        </Pill>
      </div>

      {isRequest && (
        <Panel className="mt-5 border-red-200" bodyClassName="py-4">
          <p className="text-sm font-semibold text-foreground">
            {booking.guestName ?? "A guest"} would like to book. Nothing is charged until you accept.
          </p>
          {booking.requestExpiresAt && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-stone-600">
              <Clock className="h-4 w-4" aria-hidden />
              Reply by {formatDateTime(booking.requestExpiresAt)}, or the request expires.
            </p>
          )}
          <div className="mt-3">
            <BookingRequestActions bookingId={booking.id} />
          </div>
        </Panel>
      )}

      {pendingChange && (
        <Panel className="mt-5 border-amber-200" bodyClassName="py-4">
          <p className="text-sm font-semibold text-foreground">Date change requested</p>
          <p className="mt-1 text-sm text-stone-600">
            From {formatStayDate(pendingChange.originalCheckIn)} – {formatStayDate(pendingChange.originalCheckOut)} (
            {pendingChange.originalGuests} guests) to{" "}
            <span className="font-medium text-foreground">
              {formatStayDate(pendingChange.requestedCheckIn)} – {formatStayDate(pendingChange.requestedCheckOut)} (
              {pendingChange.requestedGuests} guests)
            </span>
            .{" "}
            {pendingChange.priceDeltaCents > 0
              ? `The guest pays ${formatPrice(pendingChange.priceDeltaCents)} more.`
              : pendingChange.priceDeltaCents < 0
                ? `The guest gets ${formatPrice(-pendingChange.priceDeltaCents)} back.`
                : "The price doesn't change."}
          </p>
          <div className="mt-3">
            <ChangeRequestActions bookingId={booking.id} requestId={pendingChange.id} />
          </div>
        </Panel>
      )}

      <div className="mt-5 grid items-start gap-4 md:grid-cols-5">
        <div className="flex min-w-0 flex-col gap-4 md:col-span-3">
          <Panel title="Stay" icon={CalendarDays}>
            <div className="flex gap-4">
              <div className="relative hidden h-20 w-24 shrink-0 overflow-hidden rounded-xl bg-surface-muted sm:block">
                {booking.listing.photos[0] && (
                  <Image
                    src={booking.listing.photos[0]}
                    alt=""
                    fill
                    sizes="96px"
                    unoptimized={!isOptimizableImage(booking.listing.photos[0])}
                    className="object-cover"
                  />
                )}
              </div>
              <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-stone-500">Check-in</dt>
                  <dd className="font-medium text-foreground">{longDay.format(booking.checkIn)}</dd>
                  {booking.listing.checkInTime && <dd className="text-xs text-stone-500">{booking.listing.checkInTime}</dd>}
                </div>
                <div>
                  <dt className="text-xs text-stone-500">Check-out</dt>
                  <dd className="font-medium text-foreground">{longDay.format(booking.checkOut)}</dd>
                  {booking.listing.checkOutTime && (
                    <dd className="text-xs text-stone-500">{booking.listing.checkOutTime}</dd>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-stone-500">Length</dt>
                  <dd className="font-medium text-foreground">
                    {booking.nights} night{booking.nights === 1 ? "" : "s"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">Guests</dt>
                  <dd className="flex items-center gap-1 font-medium text-foreground">
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    {booking.guests}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/host/listings/${booking.listingId}/calendar`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <CalendarDays className="h-4 w-4" />
                Calendar
              </Link>
              <Link href={`/listings/${booking.listingId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                View listing
              </Link>
            </div>
          </Panel>

          <Panel title="Guest" icon={Users}>
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium text-foreground">{booking.guestName ?? "Guest"}</p>
              {confirmed ? (
                <>
                  {booking.guestEmail && (
                    <a href={`mailto:${booking.guestEmail}`} className="flex items-center gap-2 text-stone-700 hover:text-brand-700">
                      <Mail className="h-4 w-4 text-stone-400" aria-hidden />
                      {booking.guestEmail}
                    </a>
                  )}
                  {booking.guestPhone && (
                    <a href={`tel:${booking.guestPhone}`} className="flex items-center gap-2 text-stone-700 hover:text-brand-700">
                      <Phone className="h-4 w-4 text-stone-400" aria-hidden />
                      {booking.guestPhone}
                    </a>
                  )}
                </>
              ) : (
                <p className="text-stone-500">Contact details appear once the booking is confirmed.</p>
              )}
            </div>
            <Link
              href={conversation ? `/inbox/${conversation.id}` : "/inbox"}
              className={cn(buttonVariants({ size: "sm" }), "mt-4")}
            >
              <MessageCircle className="h-4 w-4" />
              Message {booking.guestName?.split(" ")[0] ?? "guest"}
            </Link>
          </Panel>

          {booking.depositStatus === "AUTHORIZED" && booking.depositClaimDeadline && (
            <SecurityDeposits
              deposits={[
                {
                  bookingId: booking.id,
                  listingId: booking.listingId,
                  listingTitle: booking.listing.title,
                  guestName: booking.guestName,
                  checkIn: booking.checkIn,
                  checkOut: booking.checkOut,
                  securityDepositCents: booking.securityDepositCents,
                  depositClaimDeadline: booking.depositClaimDeadline,
                },
              ]}
            />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 md:col-span-2">
          <Panel title="Your earnings" icon={CircleDollarSign}>
            <p className="text-3xl font-semibold tracking-tight text-foreground">{formatPrice(net)}</p>
            <p className="text-xs text-stone-500">
              {booking.paidAt
                ? booking.hostPaidViaConnect
                  ? `Sent to your Stripe account when the guest paid, ${formatDateTime(booking.paidAt)}.`
                  : `Guest paid ${formatDateTime(booking.paidAt)}.`
                : isRequest
                  ? "What you'll earn if you accept."
                  : "Due once the guest pays."}
            </p>
            <dl className="mt-4 flex flex-col gap-1.5 border-t border-border-subtle pt-3 text-sm">
              {nightlyChargeLines(booking, formatPrice).map((line) => (
                <Row key={line.label} label={line.label} value={line.cents} />
              ))}
              {booking.lengthOfStayDiscountCents > 0 && (
                <Row label="Length-of-stay discount" value={-booking.lengthOfStayDiscountCents} />
              )}
              {booking.cleaningFeeCents > 0 && <Row label="Cleaning fee" value={booking.cleaningFeeCents} />}
              <Row label="Your share" value={roomCents + booking.cleaningFeeCents} strong />
              {refunded > 0 && booking.paidAt && (
                <Row label="Your part of the refund" value={-(gross - net)} />
              )}
            </dl>
            <dl className="mt-3 flex flex-col gap-1.5 border-t border-border-subtle pt-3 text-xs text-stone-500">
              <Row label="Guest paid in total" value={booking.totalPriceCents} muted />
              <Row label="FYStay service fee (paid by the guest)" value={fystayFee} muted />
              <Row label="Card processing" value={0} muted note="FYStay covers it" />
              {refunded > 0 && <Row label="Refunded to guest" value={refunded} muted />}
            </dl>
          </Panel>

          <Panel title="Timeline" icon={Clock}>
            <ol className="relative flex flex-col gap-3 border-l border-border-subtle pl-4">
              {timeline.map((e) => (
                <li key={`${e.label}-${e.at.toISOString()}`} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-surface" aria-hidden />
                  <span className="block text-foreground">{e.label}</span>
                  <span className="block text-xs text-stone-500">{formatDateTime(e.at)}</span>
                </li>
              ))}
            </ol>
          </Panel>

          {confirmed && booking.checkOut > today && (
            <Panel bodyClassName="flex items-start gap-3 py-4">
              <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden />
              <p className="text-sm text-stone-600">
                Need to cancel this stay?{" "}
                <Link href="/contact" className="font-medium text-brand-700">
                  Contact FYStay support
                </Link>{" "}
                - we&apos;ll rehouse or refund the guest fairly.
              </p>
            </Panel>
          )}
          {booking.depositStatus === "CAPTURED" && (
            <Panel bodyClassName="flex items-start gap-3 py-4">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <p className="text-sm text-stone-600">
                Deposit claim of {formatPrice(booking.depositCapturedCents ?? 0)}{" "}
                {booking.depositTransferredAt ? "paid to your Stripe account." : "is on its way to your Stripe account."}
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
  note,
}: {
  label: string;
  value: number;
  strong?: boolean;
  muted?: boolean;
  note?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "font-semibold text-foreground")}>
      <dt className={muted ? undefined : "text-stone-600"}>{label}</dt>
      <dd className={cn("tabular-nums", !muted && "text-foreground")}>
        {note ? `${formatPrice(value)} · ${note}` : value < 0 ? `−${formatPrice(-value)}` : formatPrice(value)}
      </dd>
    </div>
  );
}
