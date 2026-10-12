"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, Clock, ShieldAlert, ShieldQuestion } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type Status = "NONE" | "PENDING" | "VERIFIED" | "FAILED";

const statusCopy: Record<Status, { label: string; variant: BadgeProps["variant"] }> = {
  NONE: { label: "Not started", variant: "neutral" },
  PENDING: { label: "In progress", variant: "warning" },
  VERIFIED: { label: "Verified", variant: "success" },
  FAILED: { label: "Not verified", variant: "warning" },
};

/**
 * Real government-ID + selfie verification via Stripe Identity - see
 * src/lib/identity.ts. `status`, `processing` and `failureReason` come from
 * the server, read back from Stripe where a check is unfinished.
 * `configured` is Stripe being set up at all - without it there's no
 * button, only an explanation.
 */
export function IdentityVerificationCard({
  status,
  processing = false,
  failureReason = null,
  configured,
}: {
  status: Status;
  processing?: boolean;
  failureReason?: string | null;
  configured: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function startVerification() {
    setLoading(true);
    try {
      const res = await fetch("/api/account/identity/start", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        toast.error(data?.error ?? "Could not start identity verification.");
        setLoading(false);
        if (res.status === 409) router.refresh();
        return;
      }
      window.location.href = data.url;
    } catch {
      toast.error("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  const badge = status === "PENDING" && processing ? { label: "Checking", variant: "warning" as const } : statusCopy[status];

  return (
    <Card className="p-5" id="identity-verification">
      <CardHeader className="flex-row items-center justify-between gap-3 p-0">
        <CardTitle className="flex items-center gap-2">
          {status === "VERIFIED" ? (
            <BadgeCheck className="h-4.5 w-4.5 text-brand-600" aria-hidden />
          ) : status === "FAILED" ? (
            <ShieldAlert className="h-4.5 w-4.5 text-amber-500" aria-hidden />
          ) : status === "PENDING" ? (
            <Clock className="h-4.5 w-4.5 text-amber-500" aria-hidden />
          ) : (
            <ShieldQuestion className="h-4.5 w-4.5 text-stone-400" aria-hidden />
          )}
          Identity verification
        </CardTitle>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </CardHeader>
      <CardContent className="mt-3 flex flex-col gap-3 p-0 text-sm text-stone-600" aria-live="polite">
        {status === "VERIFIED" ? (
          // A past verification stays true regardless of whether Stripe
          // happens to be configured in this environment right now - only
          // starting a NEW verification needs `configured`.
          <p>Your government ID has been verified. This shows other guests and hosts you&apos;re a real, verified person.</p>
        ) : !configured ? (
          <p>
            Identity checks aren&apos;t switched on yet, so there&apos;s nothing to do here for now. Your account
            shows as not verified until you complete one.
          </p>
        ) : status === "PENDING" && processing ? (
          <>
            <p>
              Thanks - Stripe is checking your ID and selfie. This usually takes a few minutes. Your account shows
              as verified only once the check passes.
            </p>
            <Button variant="outline" size="sm" className="self-start" onClick={() => router.refresh()}>
              Check again
            </Button>
          </>
        ) : (
          <>
            <p>
              Verify your identity with a government ID and a selfie, handled securely by Stripe -
              FYStay never sees or stores your ID.
            </p>
            {status === "PENDING" && <p>You started a check but haven&apos;t finished it yet.</p>}
            {status === "FAILED" && (
              <p className="text-amber-700">
                Your last attempt didn&apos;t pass.{failureReason ? ` ${failureReason}` : ""} You can try again.
              </p>
            )}
            <Button onClick={startVerification} loading={loading} className="self-start">
              {status === "PENDING" ? "Continue verification" : status === "FAILED" ? "Try again" : "Verify your identity"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
