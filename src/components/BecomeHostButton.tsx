"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/** Turns a signed-in guest's account into a host account, then opens the new-listing form. */
export function BecomeHostButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    const res = await fetch("/api/account/become-host", { method: "POST" });
    if (res.ok) {
      router.push("/host/listings/new");
      router.refresh();
    } else {
      setPending(false);
      toast.error("We couldn't set up hosting on your account. Please try again.");
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={pending} className={className}>
      {pending ? "Setting up…" : children}
    </button>
  );
}
