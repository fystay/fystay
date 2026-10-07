"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { formatDate, formatPrice, formatStayDate } from "@/lib/format";

export type AuthorizedDeposit = {
  bookingId: string;
  listingId: string;
  listingTitle: string;
  guestName: string | null;
  checkIn: Date;
  checkOut: Date;
  securityDepositCents: number;
  depositClaimDeadline: Date;
};

/**
 * Every currently AUTHORIZED security-deposit hold across a host's
 * listings - separate from NeedsAttention, since nothing here forces a
 * response. Every one of these releases on its own at
 * depositClaimDeadline (see /api/cron/security-deposits) unless the host
 * proactively files a claim; a host with a clean stay does nothing here at
 * all.
 */
export function SecurityDeposits({ deposits }: { deposits: AuthorizedDeposit[] }) {
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const visible = deposits.filter((d) => !resolvedIds.has(d.bookingId));

  if (visible.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
        <ShieldCheck className="h-4.5 w-4.5 text-brand-600" />
        Security deposits
      </h2>
      <div className="mt-3 flex flex-col gap-3">
        {visible.map((deposit) => (
          <DepositRow
            key={deposit.bookingId}
            deposit={deposit}
            onResolved={() => setResolvedIds((prev) => new Set(prev).add(deposit.bookingId))}
          />
        ))}
      </div>
    </div>
  );
}

function DepositRow({ deposit, onResolved }: { deposit: AuthorizedDeposit; onResolved: () => void }) {
  const router = useRouter();
  const [claimOpen, setClaimOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function respond(body: { action: "release" } | { action: "capture"; amountCents: number; reason: string }) {
    setSubmitting(true);
    let res: Response;
    let data: { error?: string };
    try {
      res = await fetch(`/api/bookings/${deposit.bookingId}/deposit/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      setSubmitting(false);
      toast.error("Couldn't reach FYStay - check your connection and try again. Nothing has been charged.");
      return;
    }
    setSubmitting(false);
    if (!res.ok) {
      toast.error(data.error ?? "Could not resolve this deposit.");
      return;
    }
    toast.success(body.action === "release" ? "Deposit released" : "Deposit claim filed");
    setClaimOpen(false);
    onResolved();
    router.refresh();
  }

  function handleClaimSubmit() {
    const amountCents = Math.round(Number(amount) * 100);
    if (!amountCents || amountCents <= 0) {
      toast.error("Enter an amount to claim.");
      return;
    }
    if (amountCents > deposit.securityDepositCents) {
      toast.error(`You can't claim more than ${formatPrice(deposit.securityDepositCents)}.`);
      return;
    }
    if (!reason.trim()) {
      toast.error("Explain what the claim is for - the guest will see this.");
      return;
    }
    respond({ action: "capture", amountCents, reason: reason.trim() });
  }

  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium text-foreground">
          {formatPrice(deposit.securityDepositCents)} authorized - {deposit.guestName ?? "a guest"}
        </p>
        <p className="text-sm text-stone-600">
          <Link href={`/listings/${deposit.listingId}`} className="hover:text-brand-700">
            {deposit.listingTitle}
          </Link>{" "}
          · {formatStayDate(deposit.checkIn)} – {formatStayDate(deposit.checkOut)}
        </p>
        <p className="text-xs text-stone-500">
          Releases automatically {formatDate(deposit.depositClaimDeadline)} unless you file a claim
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => respond({ action: "release" })} disabled={submitting}>
          Release now
        </Button>
        <Button size="sm" onClick={() => setClaimOpen(true)} disabled={submitting}>
          File a claim
        </Button>
      </div>

      <Dialog open={claimOpen} onClose={() => setClaimOpen(false)} title="File a damage claim">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-stone-600">
            This charges the guest&apos;s card for the amount you specify, up to the authorized{" "}
            {formatPrice(deposit.securityDepositCents)}. The guest will see the reason you give.
          </p>
          <Field>
            <Label htmlFor="claimAmount">Amount to claim (£)</Label>
            <Input
              id="claimAmount"
              type="number"
              min="0"
              max={deposit.securityDepositCents / 100}
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field>
            <Label htmlFor="claimReason">Reason (shown to the guest)</Label>
            <Textarea
              id="claimReason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Broken lamp in the living room, replacement cost £45"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setClaimOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleClaimSubmit} loading={submitting}>
              Claim {amount ? formatPrice(Math.round(Number(amount) * 100)) : ""}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
