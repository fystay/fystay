"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { useNavTone } from "@/components/NavTone";

/** Saved (the wishlist), in the header just left of the account menu. */
export function SavedLink() {
  const isHero = useNavTone() === "hero";

  return (
    <Link
      href="/wishlist"
      className={cn(
        "focus-ring flex items-center gap-1.5 rounded-sm text-sm font-medium text-stone-600 transition-colors hover:text-brand-700",
        isHero && "text-white/90 hover:text-white",
      )}
    >
      <Heart className="h-4 w-4" aria-hidden />
      Saved
    </Link>
  );
}
