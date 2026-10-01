"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";

/** Suspend (with a reason the host can see) or reinstate a listing, via PATCH /api/admin/listings/[id]/suspend. */
export function ListingSuspendActions({ listingId, suspended }: { listingId: string; suspended: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(suspend: boolean) {
    setLoading(true);
    const res = await fetch(`/api/admin/listings/${listingId}/suspend`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(suspend ? { suspended: true, reason: reason.trim() || undefined } : { suspended: false }),
    });
    const data = await res.json().catch(() => null);
    setLoading(false);
    if (!res.ok) {
      toast.error(data?.error ?? "That didn't go through.");
      return;
    }
    toast.success(suspend ? "Listing suspended" : "Listing reinstated");
    setOpen(false);
    setReason("");
    router.refresh();
  }

  if (suspended) {
    return (
      <Button type="button" variant="outline" size="sm" loading={loading} onClick={() => submit(false)}>
        Reinstate
      </Button>
    );
  }

  return (
    <>
      <Button type="button" variant="danger" size="sm" onClick={() => setOpen(true)}>
        Suspend
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Suspend this listing?">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-stone-600">
            It disappears from search and can&apos;t be booked. Existing bookings aren&apos;t
            cancelled. The host still sees the listing, with the reason below.
          </p>
          <Field>
            <Label htmlFor={`suspend-reason-${listingId}`}>Reason (shown to the host)</Label>
            <Textarea
              id={`suspend-reason-${listingId}`}
              value={reason}
              maxLength={1000}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Never mind
            </Button>
            <Button type="button" variant="danger" loading={loading} onClick={() => submit(true)}>
              Suspend listing
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
