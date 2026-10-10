import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarCheck2, CreditCard, History, Ticket, AlertTriangle } from "lucide-react";
import { auth } from "@/auth";
import { getBookingDetailForAdmin } from "@/lib/adminBookingLookup";
import { bookingCancellationTerms, previewCancellation } from "@/lib/cancellationPolicy";
import { formatPrice } from "@/lib/format";
import { SectionHeading } from "@/components/SectionHeading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { AdminCancelBookingDialog } from "@/components/admin/AdminCancelBookingDialog";
import { stripeDashboardPaymentUrl } from "@/lib/stripe";

export const metadata: Metadata = { title: "Booking detail", robots: { index: false } };

const STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "neutral",
  COMPLETED: "brand",
  REFUNDED: "neutral",
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** Support's full view of one booking - see getBookingDetailForAdmin for exactly what's queried. */
export default async function AdminBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=/admin/bookings/${id}`);
  if (session.user.role !== "ADMIN") redirect("/");

  const booking = await getBookingDetailForAdmin(id);
  if (!booking) notFound();

  const canCancel = booking.status === "PENDING" || booking.status === "CONFIRMED";
  const wasPaid = booking.paymentStatus === "PAID";
  const refundPreview = previewCancellation({
    listing: bookingCancellationTerms(booking),
    wasPaid,
    totalPriceCents: booking.totalPriceCents,
    checkIn: booking.checkIn,
    paidAt: booking.paidAt,
  });

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <Link
        href="/admin/bookings"
        className="focus-ring inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-stone-500 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to bookings
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{booking.listing.title}</h1>
          <p className="mt-1 font-mono text-sm text-stone-500">Booking #{booking.reference}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant={STATUS_VARIANT[booking.status] ?? "neutral"}>{booking.status}</Badge>
          <Badge variant="neutral">{booking.paymentStatus.replace(/_/g, " ")}</Badge>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <SectionHeading icon={CalendarCheck2}>Stay</SectionHeading>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-stone-700">
              <p>
                <span className="text-stone-500">Listing:</span> {booking.listing.title}
              </p>
              <p>
                <span className="text-stone-500">Location:</span> {booking.listing.city},{" "}
                {booking.listing.country}
              </p>
              <p>
                <span className="text-stone-500">Check-in:</span>{" "}
                {dateFormatter.format(booking.checkIn)}
              </p>
              <p>
                <span className="text-stone-500">Check-out:</span>{" "}
                {dateFormatter.format(booking.checkOut)}
              </p>
              <p>
                <span className="text-stone-500">Nights:</span> {booking.nights}
              </p>
              <p>
                <span className="text-stone-500">Guests:</span> {booking.guests}
              </p>
              <p>
                <span className="text-stone-500">Approval status:</span> {booking.approvalStatus}
              </p>
              <p>
                <span className="text-stone-500">Created:</span>{" "}
                {dateFormatter.format(booking.createdAt)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeading icon={CreditCard}>Payment</SectionHeading>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-stone-700">
              <p>
                <span className="text-stone-500">Total:</span> {formatPrice(booking.totalPriceCents)}
              </p>
              <p>
                <span className="text-stone-500">Service fee:</span>{" "}
                {formatPrice(booking.serviceFeeCents)}
              </p>
              <p>
                <span className="text-stone-500">Refunded so far:</span>{" "}
                {booking.refundedAmountCents !== null ? formatPrice(booking.refundedAmountCents) : "—"}
              </p>
              <p>
                <span className="text-stone-500">Paid via Connect:</span>{" "}
                {booking.hostPaidViaConnect ? "Yes" : "No"}
              </p>
              {/* The original booking payment's split (date-change payments are listed below). */}
              <p>
                <span className="text-stone-500">FYStay fee:</span>{" "}
                {booking.hostPaidViaConnect && booking.applicationFeeCents !== null
                  ? formatPrice(booking.applicationFeeCents)
                  : "—"}
              </p>
              <p>
                <span className="text-stone-500">Host receives:</span>{" "}
                {booking.hostPaidViaConnect && booking.applicationFeeCents !== null
                  ? formatPrice(booking.totalPriceCents - booking.applicationFeeCents)
                  : "—"}
              </p>
              <p className="col-span-2 break-all">
                <span className="text-stone-500">Stripe payment intent:</span>{" "}
                {booking.stripePaymentIntentId ? (
                  <a
                    href={stripeDashboardPaymentUrl(booking.stripePaymentIntentId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {booking.stripePaymentIntentId} (open in Stripe)
                  </a>
                ) : (
                  "—"
                )}
              </p>
              <p className="col-span-2 break-all">
                <span className="text-stone-500">Stripe checkout session:</span>{" "}
                {booking.stripeSessionId ?? "—"}
              </p>
            </CardContent>
          </Card>

          {booking.changeRequests.length > 0 && (
            <Card>
              <CardHeader>
                <SectionHeading icon={History}>Change requests</SectionHeading>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {booking.changeRequests.map((cr) => (
                  <div key={cr.id} className="rounded-lg bg-surface-muted p-3 text-sm text-stone-700">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">{cr.status}</span>
                      <span className="text-xs text-stone-500">
                        {dateFormatter.format(cr.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1">
                      Requested {dateFormatter.format(cr.requestedCheckIn)} –{" "}
                      {dateFormatter.format(cr.requestedCheckOut)}, {cr.requestedGuests} guests
                    </p>
                    <p className="mt-1">Price delta: {formatPrice(cr.priceDeltaCents)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {booking.extras.length > 0 && (
            <Card>
              <CardHeader>
                <SectionHeading icon={Ticket}>Trip extras</SectionHeading>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {booking.extras.map((extra) => (
                  <div
                    key={extra.id}
                    className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2 text-sm"
                  >
                    <span className="text-stone-700">{extra.offering.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums text-stone-700">{formatPrice(extra.priceCents)}</span>
                      <Badge variant="neutral">{extra.status}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {booking.disputes.length > 0 && (
            <Card>
              <CardHeader>
                <SectionHeading icon={AlertTriangle}>Disputes</SectionHeading>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {booking.disputes.map((dispute) => (
                  <div
                    key={dispute.id}
                    className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2 text-sm"
                  >
                    <span className="text-stone-700">{dispute.reason.replace(/_/g, " ")}</span>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums text-stone-700">
                        {formatPrice(dispute.amountCents)}
                      </span>
                      <Badge variant="warning">{dispute.status.replace(/_/g, " ")}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {booking.pmsReservationLink && (
            <Card>
              <CardHeader>
                <CardTitle>PMS sync</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-stone-700">
                <p>
                  <span className="text-stone-500">External reservation id:</span>{" "}
                  {booking.pmsReservationLink.externalReservationId ?? "—"}
                </p>
                <p>
                  <span className="text-stone-500">Push status:</span>{" "}
                  {booking.pmsReservationLink.pushStatus ?? "—"}
                </p>
                <p>
                  <span className="text-stone-500">Cancel push status:</span>{" "}
                  {booking.pmsReservationLink.cancelPushStatus ?? "—"}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Guest</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm text-stone-700">
              <p>{booking.guestName ?? booking.guest.name}</p>
              <p className="text-stone-500">{booking.guestEmail ?? booking.guest.email}</p>
              {booking.guestPhone && <p className="text-stone-500">{booking.guestPhone}</p>}
              <Link
                href={`/admin/users/${booking.guest.id}`}
                className="mt-2 text-sm text-brand-700 hover:underline"
              >
                View account
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Host</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm text-stone-700">
              <p>{booking.listing.host.name}</p>
              <p className="text-stone-500">{booking.listing.host.email}</p>
              <Link
                href={`/admin/users/${booking.listing.host.id}`}
                className="mt-2 text-sm text-brand-700 hover:underline"
              >
                View account
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Support actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Link href={`/bookings/${booking.id}`} className="text-sm text-brand-700 hover:underline">
                View as guest would see it
              </Link>
              {canCancel ? (
                <AdminCancelBookingDialog
                  bookingId={booking.id}
                  reference={booking.reference}
                  policyLabel={refundPreview.policyLabel}
                  policyDescription={refundPreview.policyDescription}
                  amountPaidCents={refundPreview.amountPaidCents}
                  defaultRefundCents={refundPreview.refundCents}
                />
              ) : (
                <p className="text-sm text-stone-500">
                  This booking is {booking.status.toLowerCase()} - nothing to cancel.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
