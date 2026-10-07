"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";

export function BookingRequestActions({
  bookingId,
  onOptimisticStart,
  onError,
}: {
  bookingId: string;
  /** Called immediately on click, before the server has responded. */
  onOptimisticStart?: () => void;
  /** Called if the server ultimately rejects the response, to undo the optimistic update. */
  onError?: () => void;
}) {
  const router = useRouter();
  // Which button is working, so it shows a spinner and neither can be
  // pressed twice while the answer is on its way.
  const [pending, setPending] = useState<"approve" | "decline" | null>(null);

  async function respond(action: "approve" | "decline") {
    onOptimisticStart?.();

    setPending(action);
    let res: Response;
    try {
      res = await fetch(`/api/bookings/${bookingId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } catch {
      setPending(null);
      onError?.();
      toast.error("Couldn't reach FYStay - check your connection and try again.");
      return;
    }
    setPending(null);

    if (res.ok) {
      toast.success(action === "approve" ? "Request approved" : "Request declined");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      onError?.();
      toast.error(data?.error ?? "Could not respond to this request.");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        loading={pending === "decline"}
        disabled={pending !== null}
        onClick={() => respond("decline")}
      >
        Decline
      </Button>
      <Button size="sm" loading={pending === "approve"} disabled={pending !== null} onClick={() => respond("approve")}>
        Approve
      </Button>
    </div>
  );
}
