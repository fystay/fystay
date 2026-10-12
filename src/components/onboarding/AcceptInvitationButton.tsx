"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/Label";

export function AcceptInvitationButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/host-invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string; listingIds?: string[] } | null;
    if (!res?.ok) {
      setBusy(false);
      setError(data?.error ?? "Couldn't reach FYStay - try again.");
      return;
    }
    const [first] = data?.listingIds ?? [];
    router.push(first ? `/host/listings/${first}/review` : "/host/listings");
    router.refresh();
  }

  return (
    <div className="mt-6">
      <Button onClick={accept} disabled={busy}>
        {busy ? "Accepting…" : "Accept and review my listing"}
      </Button>
      <FieldError>{error}</FieldError>
    </div>
  );
}
