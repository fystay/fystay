import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ReceiptText } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { PrintButton } from "@/components/PrintButton";
import { cn } from "@/lib/cn";
import { nightlyChargeLines, stayDiscountName } from "@/lib/pricing";

export const metadata: Metadata = { title: "Receipt", robots: { index: false } };

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default async function BookingReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=/bookings/${id}/receipt`);
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { listing: true },
  });

  if (!booking || booking.guestId !== session.user.id) {
    notFound();
  }

  const wasPaid =
    booking.paymentStatus === "PAID" ||
    booking.paymentStatus === "PARTIALLY_REFUNDED" ||
    booking.paymentStatus === "REFUNDED";
  const refundedAmountCents = booking.refundedAmountCents ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <Link
        href={`/bookings/${booking.id}`}
        className="focus-ring inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-stone-500 hover:text-foreground print:hidden"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to booking
      </Link>

      {!wasPaid ? (
        <Card className="mt-6 flex flex-col items-center gap-3 p-12 text-center">
          <ReceiptText className="h-8 w-8 text-stone-300" />
          <p className="font-medium text-foreground">No receipt available yet</p>
          <p className="max-w-sm text-sm text-stone-500">
            A receipt is generated once this booking has been paid for.
          </p>
          <Link href={`/bookings/${booking.id}`} className={cn(buttonVariants(), "mt-2")}>
            Back to booking
          </Link>
        </Card>
      ) : (
        <Card className="mt-6 p-6 print:border-none print:shadow-none">
          <CardContent className="flex flex-col gap-6 p-0">
            <div className="flex items-start justify-between gap-4 border-b border-border-subtle pb-4">
              <div>
                <p className="text-lg font-bold text-foreground">FYStay</p>
                <h1 className="text-sm font-semibold text-stone-500">Payment receipt</h1>
              </div>
              <div className="text-right text-sm text-stone-500">
                <p>
                  Receipt for booking <span className="font-medium text-foreground">#{booking.reference}</span>
                </p>
                {booking.paidAt && <p>Paid on {dateFormatter.format(booking.paidAt)}</p>}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Property
              </p>
              <p className="mt-1 font-medium text-foreground">{booking.listing.title}</p>
              <p className="text-sm text-stone-500">
                {/* The street address only for a stay that's going ahead, as on the booking page. */}
                {booking.listing.address && (booking.status === "CONFIRMED" || booking.status === "COMPLETED")
                  ? `${booking.listing.address}, `
                  : ""}
                {booking.listing.city}, {booking.listing.country}
              </p>
            </div>

            {(booking.guestName || booking.guestEmail || booking.guestPhone) && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Billed to
                </p>
                {booking.guestName && <p className="mt-1 text-sm text-foreground">{booking.guestName}</p>}
                {booking.guestEmail && <p className="text-sm text-stone-500">{booking.guestEmail}</p>}
                {booking.guestPhone && <p className="text-sm text-stone-500">{booking.guestPhone}</p>}
              </div>
            )}

            <dl className="grid grid-cols-2 gap-y-1.5 border-t border-border-subtle pt-4 text-sm">
              <dt className="text-stone-500">Check-in</dt>
              <dd className="text-right text-foreground">{dateFormatter.format(booking.checkIn)}</dd>
              <dt className="text-stone-500">Check-out</dt>
              <dd className="text-right text-foreground">{dateFormatter.format(booking.checkOut)}</dd>
              <dt className="text-stone-500">Length of stay</dt>
              <dd className="text-right text-foreground">
                {booking.nights} night{booking.nights === 1 ? "" : "s"}
              </dd>
              <dt className="text-stone-500">Guests</dt>
              <dd className="text-right text-foreground">
                {booking.guests} guest{booking.guests === 1 ? "" : "s"}
              </dd>
            </dl>

            <div className="flex flex-col gap-2 border-t border-border-subtle pt-4 text-sm text-stone-700">
              {nightlyChargeLines(booking, formatPrice).map((line) => (
                <div key={line.label} className="flex justify-between">
                  <span>{line.label}</span>
                  <span>{formatPrice(line.cents)}</span>
                </div>
              ))}
              {booking.lengthOfStayDiscountCents > 0 && (
                <div className="flex justify-between text-brand-700">
                  <span>
                    {stayDiscountName(booking.lengthOfStayDiscountLabel)}
                  </span>
                  <span>&minus;{formatPrice(booking.lengthOfStayDiscountCents)}</span>
                </div>
              )}
              {booking.cleaningFeeCents > 0 && (
                <div className="flex justify-between">
                  <span>Cleaning fee</span>
                  <span>{formatPrice(booking.cleaningFeeCents)}</span>
                </div>
              )}
              {booking.serviceFeeCents > 0 && (
                <div className="flex justify-between">
                  <span>Service fee</span>
                  <span>{formatPrice(booking.serviceFeeCents)}</span>
                </div>
              )}
              {booking.taxCents > 0 && (
                <div className="flex justify-between">
                  <span>Taxes</span>
                  <span>{formatPrice(booking.taxCents)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border-subtle pt-3 text-base font-semibold text-foreground">
                <span>Total charged (GBP)</span>
                <span>{formatPrice(booking.totalPriceCents)}</span>
              </div>
              {refundedAmountCents > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>
                    {booking.paymentStatus === "REFUNDED" ? "Refunded" : "Partially refunded"}
                  </span>
                  <span>-{formatPrice(refundedAmountCents)}</span>
                </div>
              )}
            </div>

            <p className="text-xs text-stone-500">
              This receipt was generated automatically by FYStay and reflects the amount actually
              charged for booking #{booking.reference}.
            </p>
          </CardContent>
        </Card>
      )}

      {wasPaid && (
        <div className="mt-4 flex justify-end print:hidden">
          <PrintButton />
        </div>
      )}
    </div>
  );
}
