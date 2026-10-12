"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field, FieldError, Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";

/** Assign or transfer a listing to another host, via PUT /api/admin/listings/[id]/host. */
export function ListingTransferAction({ listingId, listingTitle }: { listingId: string; listingTitle: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch(`/api/admin/listings/${listingId}/host`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostEmail: email.trim(), note: note.trim() || undefined }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      setError(data?.error ?? "Couldn't reach FYStay - check your connection and try again.");
      return;
    }
    toast.success("Listing transferred - it's unpublished until the new host checks it.");
    setOpen(false);
    setEmail("");
    setNote("");
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Transfer
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Transfer this listing?">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-sm text-stone-600">
            <strong className="font-medium text-foreground">{listingTitle}</strong> moves to the host below and comes
            off the site until they&apos;ve checked it. The current host loses access, and its calendar links stop
            working. Listings with upcoming bookings or guest messages can&apos;t be transferred.
          </p>
          <Field>
            <Label htmlFor={`transfer-email-${listingId}`}>New host&apos;s email</Label>
            <Input
              id={`transfer-email-${listingId}`}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field>
            <Label htmlFor={`transfer-note-${listingId}`}>Reason (kept in the admin record)</Label>
            <Textarea id={`transfer-note-${listingId}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <FieldError>{error}</FieldError>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Never mind
            </Button>
            <Button type="submit" variant="danger" loading={loading}>
              Transfer listing
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
