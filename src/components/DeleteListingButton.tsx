"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/Dialog";

export function DeleteListingButton({
  listingId,
  listingTitle,
  onDeleted,
  onDeleteFailed,
}: {
  listingId: string;
  listingTitle: string;
  /** Called immediately on confirm, before the server has responded. */
  onDeleted?: () => void;
  /** Called if the server ultimately rejects the deletion, to undo the optimistic update. */
  onDeleteFailed?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function handleDelete() {
    // Optimistic: the listing disappears from the list the instant you
    // confirm; the request below just makes it real in the background.
    setOpen(false);
    onDeleted?.();

    const res = await fetch(`/api/listings/${listingId}`, { method: "DELETE" });

    if (res.ok) {
      toast.success("Listing deleted");
      router.refresh();
    } else {
      onDeleteFailed?.();
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(body?.error ?? "Could not delete listing.");
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="focus-ring flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </button>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleDelete}
        danger
        title="Delete listing"
        description={`Delete "${listingTitle}"? This cannot be undone. Listings that have had bookings can't be deleted - unpublish them instead.`}
        confirmLabel="Delete"
      />
    </>
  );
}
