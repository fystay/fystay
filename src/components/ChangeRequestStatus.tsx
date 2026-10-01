"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatPrice, formatStayDate } from "@/lib/format";

export function ChangeRequestStatus({
  bookingId,
  requestId,
  status,
  requestedCheckIn,
  requestedCheckOut,
  requestedGuests,
  priceDeltaCents,
  originalTotalPriceCents,
  paidAt,
  onWithdrawn,
  onWithdrawFailed,
}: {
  bookingId: string;
  requestId: string;
  status: "PENDING" | "APPROVED" | "DECLINED";
  requestedCheckIn: Date;
  requestedCheckOut: Date;
  requestedGuests: number;
  priceDeltaCents: number;
  /** The booking's total at the moment this request was made - stays accurate even after the booking itself is later mutated. */
  originalTotalPriceCents: number;
  paidAt: Date | null;
  /** Called immediately when the guest withdraws, before the server confirms. */
  onWithdrawn?: () => void;
  /** Called if the server ultimately rejects the withdrawal, to undo the optimistic update. */
  onWithdrawFailed?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function withdraw() {
    // Optimistic: hide this banner right away; only the pay flow below has
    // to wait on the network, since it needs a real checkout URL to send you to.
    onWithdrawn?.();

    const res = await fetch(`/api/bookings/${bookingId}/change-requests/${requestId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Request withdrawn");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      onWithdrawFailed?.();
      toast.error(data?.error ?? "Could not withdraw request.");
    }
  }

  async function pay() {
    setLoading(true);
    const res = await fetch(`/api/bookings/${bookingId}/change-requests/${requestId}/pay`, {
      method: "POST",
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error ?? "Could not start payment.");
      return;
    }
    window.location.href = data.url;
  }

  const dateLabel = `${formatStayDate(requestedCheckIn)} – ${formatStayDate(requestedCheckOut)} · ${requestedGuests} guest${requestedGuests > 1 ? "s" : ""}`;
  const newTotalPriceCents = originalTotalPriceCents + priceDeltaCents;

  const priceSummary = priceDeltaCents !== 0 && (
    <div className="flex flex-col gap-1 border-t border-border-subtle pt-2 text-stone-600">
      <div className="flex justify-between">
        <span>Original total</span>
        <span>{formatPrice(originalTotalPriceCents)}</span>
      </div>
      <div className="flex justify-between">
        <span>New total</span>
        <span>{formatPrice(newTotalPriceCents)}</span>
      </div>
      <div className="flex justify-between font-semibold text-foreground">
        <span>{priceDeltaCents > 0 ? "Additional payment" : "Refund due"}</span>
        <span>{formatPrice(Math.abs(priceDeltaCents))}</span>
      </div>
    </div>
  );

  if (status === "PENDING") {
    return (
      <div className="mt-3 flex flex-col gap-1.5 rounded-lg bg-surface-muted p-3 text-sm">
        <div className="flex items-center gap-2">
          <Badge variant="warning">Change requested</Badge>
          <span className="text-stone-600">Awaiting host response</span>
        </div>
        <p className="text-stone-600">{dateLabel}</p>
        {priceSummary}
        <button
          onClick={withdraw}
          disabled={loading}
          className="focus-ring self-start rounded-lg text-sm font-medium text-stone-600 underline-offset-2 hover:underline disabled:opacity-50"
        >
          Withdraw request
        </button>
      </div>
    );
  }

  if (status === "DECLINED") {
    return (
      <div className="mt-3 flex flex-col gap-1.5 rounded-lg bg-surface-muted p-3 text-sm">
        <div className="flex items-center gap-2">
          <Badge variant="neutral">Change declined</Badge>
        </div>
        <p className="text-stone-600">The host declined this change request.</p>
      </div>
    );
  }

  // APPROVED
  if (priceDeltaCents > 0 && !paidAt) {
    return (
      <div className="mt-3 flex flex-col gap-1.5 rounded-lg bg-surface-muted p-3 text-sm">
        <div className="flex items-center gap-2">
          <Badge variant="success">Change approved</Badge>
        </div>
        <p className="text-stone-600">{dateLabel}</p>
        {priceSummary}
        <p className="text-stone-600">
          Pay {formatPrice(priceDeltaCents)} to confirm these new dates.
        </p>
        <Button size="sm" onClick={pay} loading={loading} className="self-start">
          Pay {formatPrice(priceDeltaCents)}
        </Button>
      </div>
    );
  }

  return null;
}
