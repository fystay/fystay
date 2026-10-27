import type { LucideIcon } from "lucide-react";

/**
 * The small icon-badge + heading pairing used across the listing detail
 * page's content sections (About, Amenities, Getting around, Cancellation
 * policy, Reviews) - one "icon in a soft brand circle" language, so a guest
 * sees one consistent visual vocabulary for "here's a labelled block of
 * information" rather than a plain-text heading here and an icon badge there.
 */
export function SectionHeading({
  icon: Icon,
  children,
  id,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <h2 id={id} className={id ? "scroll-mt-20 flex items-center gap-2.5" : "flex items-center gap-2.5"}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      {/* No font-semibold here - globals.css forces every h1/h2 to DM
          Serif Display's one real weight (400) specifically so the
          browser never fakes a bold face for it, but that override only
          reaches this h2's own computed style. A font-semibold class on
          this span would set its own 600 right back, which the browser
          then has no real 600 glyphs for and synthesizes (the "chunky,
          uneven" look that override exists to prevent) - so this just
          inherits the h2's true weight like every other heading does. */}
      <span className="text-lg text-foreground">{children}</span>
    </h2>
  );
}
