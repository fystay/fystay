"use client";

import { useState } from "react";
import { CheckCircle2, MailWarning } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";

/**
 * On the account page: the result of opening the "Confirm your email" link,
 * and - while the address is unconfirmed - why it matters and a way to get
 * the link again.
 */
export function EmailVerificationNotice({
  verified,
  outcome,
  email,
}: {
  verified: boolean;
  outcome: string | null;
  email: string;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function resend() {
    setSending(true);
    try {
      const res = await fetch("/api/auth/verify-email/resend", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "We couldn't send the email just now. Please try again later.");
        return;
      }
      setSent(true);
      if (data.devUrl) console.info("Verification link (local development only):", data.devUrl);
      toast.success(`Sent - check ${email}`);
    } catch {
      toast.error("Couldn't reach FYStay - check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (verified) {
    if (outcome !== "verified") return null;
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <p>
          <strong className="font-semibold">Email confirmed.</strong> Thanks - your account is fully set up.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <MailWarning className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <p>
          <strong className="font-semibold">Please confirm your email address.</strong>{" "}
          {outcome === "invalid"
            ? "That link has expired or was already used - send a new one."
            : `We sent a link to ${email}. Confirming it unlocks referral credit, promo codes and extra sign-in security.`}
        </p>
      </div>
      <Button size="sm" variant="outline" loading={sending} disabled={sent} onClick={resend} className="shrink-0">
        {sent ? "Link sent" : "Send the link again"}
      </Button>
    </div>
  );
}
