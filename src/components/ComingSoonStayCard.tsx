import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DESTINATION_PHOTOS } from "@/lib/destinationPhotos";
import { DESTINATION_ART, FALLBACK_ART } from "@/components/destinationArt";
import { ARCH_IMAGE_CLASS, EDITORIAL_RULE_CLASS, LARGE_CARD_IMAGE_CLASS } from "@/components/LargeCard";
import type { FyldeCoastDestination } from "@/lib/destinations";
import { cn } from "@/lib/cn";

/**
 * A clearly-labelled placeholder in a stays carousel while a town has no
 * stays live yet: the town's real photo (or its art), "Coming soon", and a
 * link to the town's own page - never an invented property or price.
 * badge and text let another row word it for itself (Last Minute Deals);
 * frame matches the row's own cards (arch for stays, editorial for deals).
 */
export function ComingSoonStayCard({
  destination,
  badge = "Coming soon",
  text = "Local hosts are joining FYStay - meanwhile, see the town\u2019s Local Guide.",
  frame = "arch",
}: {
  destination: FyldeCoastDestination;
  badge?: string;
  text?: string;
  frame?: "arch" | "editorial";
}) {
  const photo = DESTINATION_PHOTOS[destination.slug]?.tile;
  const art = DESTINATION_ART[destination.slug] ?? FALLBACK_ART;
  const Icon = art.icon;
  return (
    <Link href={`/destinations/${destination.slug}`} className="focus-ring group flex flex-col gap-3.5">
      <div className={cn(frame === "arch" ? ARCH_IMAGE_CLASS : LARGE_CARD_IMAGE_CLASS, "bg-gradient-to-br", art.gradient)}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-90" />
        ) : (
          <Icon className="absolute -right-4 -top-4 h-36 w-36 text-white/15" aria-hidden />
        )}
        <span className="absolute bottom-3 left-3 z-10 rounded-md bg-surface/90 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-800">
          {badge}
        </span>
      </div>
      <div className={cn("flex flex-col gap-1.5", frame === "arch" ? "px-1" : cn(EDITORIAL_RULE_CLASS, "mt-0"))}>
        <p className="text-base font-semibold leading-snug text-foreground sm:text-lg">Stays in {destination.name}</p>
        <p className="text-sm text-stone-500">{text}</p>
        <span className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-brand-700 group-hover:text-brand-800">
          Explore {destination.name}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
