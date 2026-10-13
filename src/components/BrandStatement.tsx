import { ConciergeBell, Home, MapPin } from "lucide-react";
import { EditorialHeader } from "@/components/EditorialHeader";

const BENEFITS = [
  { icon: MapPin, label: "Local knowledge" },
  { icon: Home, label: "Direct booking" },
  { icon: ConciergeBell, label: "Helpful guest services" },
];

/** A short, light brand statement near the end of the homepage - no card, no bubble. */
export function BrandStatement() {
  return (
    <section className="mt-14 border-t border-border-subtle pt-10 sm:mt-20" aria-labelledby="brand-heading">
      <EditorialHeader id="brand-heading" eyebrow="Why FYStay" title="A better way to stay on the Fylde Coast." />
      <p className="-mt-2 max-w-xl text-sm leading-relaxed text-stone-600 sm:text-base">
        Discover local places to stay, find experiences worth travelling for, and access helpful services - all in one
        place.
      </p>
      <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-3">
        {BENEFITS.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Icon className="h-4 w-4 text-brand-600" aria-hidden />
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}
