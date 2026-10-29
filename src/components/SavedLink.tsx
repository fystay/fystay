"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { useNavTone } from "@/components/NavTone";

/** Saved (the wishlist) as a heart, in the header just left of the account menu. */
export function SavedLink() {
  const isHero = useNavTone() === "hero";

  return (
    <Link
      href="/wishlist"
      aria-label="Saved"
      title="Saved"
      className={cn(
        "focus-ring flex items-center rounded-sm text-stone-600 transition-colors hover:text-brand-700",
        isHero && "text-white/90 hover:text-white",
      )}
    >
      <Heart className="h-5 w-5" aria-hidden />
    </Link>
  );
}
