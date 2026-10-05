"use client";

import { useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/Dialog";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export function SaveButton({
  listingId,
  initialSaved,
  isLoggedIn,
  className,
}: {
  listingId: string;
  initialSaved: boolean;
  isLoggedIn: boolean;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [saved, setSaved] = useState(initialSaved);
  const [promptOpen, setPromptOpen] = useState(false);
  // Guards against a second click firing a request while one is already in
  // flight, without blocking the instant visual toggle on the first click.
  const pendingRef = useRef(false);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pendingRef.current) return;

    if (!isLoggedIn) {
      // Never fail silently: a logged-out tap gets an explicit prompt to
      // sign in or create an account, not a surprise redirect.
      setPromptOpen(true);
      return;
    }

    // Optimistic: flip the heart immediately, reconcile with the server in
    // the background, and roll back only if the request actually fails.
    const optimisticSaved = !saved;
    setSaved(optimisticSaved);
    pendingRef.current = true;

    // keepalive: the heart has already flipped, so the save must still land
    // if the visitor leaves the page straight away - without it, a full
    // page load (a typed address, a refresh) cancels the request in flight
    // and the stay silently isn't saved.
    const res = await fetch("/api/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId }),
      keepalive: true,
    });
    pendingRef.current = false;

    if (!res.ok) {
      setSaved(!optimisticSaved);
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Could not update wishlist.");
      return;
    }

    const data = await res.json();
    setSaved(data.saved);
    router.refresh();
  }

  const callbackUrl = pathname || "/";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={saved}
        aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
        className={cn(
          "focus-ring flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-sm transition hover:scale-105 active:scale-95",
          className,
        )}
      >
        <Heart
          className={cn(
            "h-5 w-5 transition-transform",
            saved ? "scale-110 fill-red-500 text-red-500" : "text-stone-600",
          )}
        />
      </button>

      <Dialog open={promptOpen} onClose={() => setPromptOpen(false)} title="Save this property">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-stone-600">
            Sign in or create a free account to save properties to your wishlist and find them
            again on any device.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Link
              href={`/register?callbackUrl=${encodeURIComponent(callbackUrl)}`}
              onClick={() => setPromptOpen(false)}
              className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto")}
            >
              Create account
            </Link>
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
              onClick={() => setPromptOpen(false)}
              className={cn(buttonVariants(), "w-full sm:w-auto")}
            >
              Log in
            </Link>
          </div>
        </div>
      </Dialog>
    </>
  );
}
