import { Anchor, FerrisWheel, MapPin, TrainFront, Umbrella, Waves, Wind, type LucideIcon } from "lucide-react";

/** Each town's icon and gradient, shown when it has no photo yet (see DESTINATION_PHOTOS). */
export const DESTINATION_ART: Record<string, { icon: LucideIcon; gradient: string }> = {
  blackpool: { icon: FerrisWheel, gradient: "from-brand-600 via-brand-700 to-brand-900" },
  lytham: { icon: Wind, gradient: "from-brand-500 to-ink" },
  "st-annes": { icon: Umbrella, gradient: "from-brand-400 to-brand-900" },
  "poulton-le-fylde": { icon: TrainFront, gradient: "from-amber-700 to-ink" },
  fleetwood: { icon: Anchor, gradient: "from-ink to-brand-950" },
  "thornton-cleveleys": { icon: Waves, gradient: "from-sky-500 to-brand-800" },
};

/** Fallback look for a town with no bespoke icon/gradient in DESTINATION_ART - none currently, but kept so a future town fails gracefully. */
export const FALLBACK_ART = { icon: MapPin, gradient: "from-stone-500 to-ink" };
