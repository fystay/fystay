import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isDisputeActionable, type MappedDisputeStatus } from "@/lib/paymentDisputes";
import { SectionHeading } from "@/components/SectionHeading";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { AdminNav } from "@/components/admin/AdminNav";
import { formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Disputes", robots: { index: false } };

const STATUS_VARIANT: Record<MappedDisputeStatus, BadgeProps["variant"]> = {
  WARNING_NEEDS_RESPONSE: "warning",
  NEEDS_RESPONSE: "warning",
  WARNING_UNDER_REVIEW: "brand",
  UNDER_REVIEW: "brand",
  WARNING_CLOSED: "neutral",
  WON: "success",
  LOST: "danger",
  PREVENTED: "success",
};

const STATUS_LABEL: Record<MappedDisputeStatus, string> = {
  WARNING_NEEDS_RESPONSE: "Early warning - needs response",
  NEEDS_RESPONSE: "Needs response",
  WARNING_UNDER_REVIEW: "Early warning - under review",
  UNDER_REVIEW: "Under review",
  WARNING_CLOSED: "Early warning - closed",
  WON: "Won",
  LOST: "Lost",
  PREVENTED: "Prevented",
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Chargebacks against FYStay's own Stripe charges (see PaymentDispute's own
 * schema comment) - populated entirely by the Stripe webhook
 * (src/app/api/webhooks/stripe/route.ts's upsertPaymentDispute), never
 * created here. This page is read-only visibility plus the evidence
 * deadline highlighted before it's missed; actually responding to a
 * dispute still happens in Stripe's own dashboard, linked below.
 */
export default async function AdminDisputesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/disputes");
  if (session.user.role !== "ADMIN") redirect("/");

  const disputes = await prisma.paymentDispute.findMany({
    include: {
      booking: { select: { id: true, reference: true, listing: { select: { title: true } } } },
      bookingExtra: { select: { offering: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Disputes</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
        Bank-initiated chargebacks against payments FYStay has taken. Respond to these in the{" "}
        <a
          href="https://dashboard.stripe.com/disputes"
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 hover:underline"
        >
          Stripe dashboard
        </a>{" "}
        - this page is visibility only, not a place to submit evidence.
      </p>

      <div className="mt-6">
        <AdminNav active="/admin/disputes" />
      </div>

      <div className="mt-8">
        <SectionHeading icon={AlertTriangle}>All disputes</SectionHeading>
        {disputes.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No disputes yet.</p>
        ) : (
          <Card className="mt-3">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-xs font-medium uppercase tracking-wide text-stone-500">
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Reason</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Evidence due</th>
                      <th className="px-4 py-3">Booking</th>
                      <th className="px-4 py-3">Opened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disputes.map((dispute) => {
                      const status = dispute.status as MappedDisputeStatus;
                      const actionable = isDisputeActionable(status, dispute.evidenceDueBy);
                      const overdue = actionable && dispute.evidenceDueBy! < now;
                      return (
                        <tr key={dispute.id} className="border-b border-border-subtle last:border-0">
                          <td className="px-4 py-3 font-semibold tabular-nums text-foreground">
                            {formatPrice(dispute.amountCents)}
                          </td>
                          <td className="px-4 py-3 text-stone-700">{dispute.reason.replace(/_/g, " ")}</td>
                          <td className="px-4 py-3">
                            <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            {dispute.evidenceDueBy ? (
                              <span className={overdue ? "font-medium text-red-600" : "text-stone-700"}>
                                {dateFormatter.format(dispute.evidenceDueBy)}
                                {overdue && " (overdue)"}
                              </span>
                            ) : (
                              <span className="text-stone-500">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {dispute.booking ? (
                              <Link
                                href={`/bookings/${dispute.booking.id}`}
                                className="text-brand-700 hover:underline"
                              >
                                {dispute.booking.reference}
                              </Link>
                            ) : dispute.bookingExtra ? (
                              <span className="text-stone-700">
                                {dispute.bookingExtra.offering.name} (extra)
                              </span>
                            ) : (
                              <span className="text-stone-500">Unmatched</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-stone-500">
                            {dateFormatter.format(dispute.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
