"use client";

import Link from "next/link";
import { ArrowRight, BadgePoundSterling, Check, Handshake, Zap, type LucideIcon } from "lucide-react";
import { useFormattedPrice } from "@/components/CurrencyProvider";
import { trackAddonEvent } from "@/lib/analytics";
import { useViewOnce } from "@/hooks/useViewOnce";
import { travelAddonHref, type TravelAddonOffering } from "@/lib/travelAddons";

// An icon for each of the offering's own feature bullets (set in
// /admin/extras), matched on wording so a renamed bullet still gets a
// sensible one.
function featureIcon(feature: string): LucideIcon {
  if (/electric|tesla|ev\b/i.test(feature)) return Zap;
  if (/pric|fixed|£/i.test(feature)) return BadgePoundSterling;
  if (/meet|greet/i.test(feature)) return Handshake;
  return Check;
}

/**
 * The homepage's featured airport transfer (EV Exec, FYStay's own transfer
 * service - see docs/trip-extras-roadmap.md), given a panel of its own at
 * the top of More from FYStay rather than a tile among the rest.
 *
 * Everything it says comes from the live offering - the provider's name,
 * the description, the feature bullets and the price - so it can never
 * promise more than the offering does. The artwork is drawn, not a stock
 * photo: soft light trails over a night-time ground, the long-exposure
 * look of headlights on a motorway, until EV Exec has its own photography.
 * Same analytics events as the other add-on cards (transfer_offer_viewed /
 * transfer_offer_clicked, surface "homepage").
 */
export function TransferFeature({ offering }: { offering: TravelAddonOffering }) {
  const price = useFormattedPrice(offering.priceCents);
  const viewRef = useViewOnce<HTMLDivElement>(() => {
    trackAddonEvent({
      name: "transfer_offer_viewed",
      category: offering.category,
      surface: "homepage",
      offeringId: offering.id,
    });
  });

  return (
    <div
      ref={viewRef}
      className="group relative isolate mb-8 overflow-hidden rounded-[24px] bg-[#120d0a] text-white shadow-[var(--shadow-popover)] ring-1 ring-white/5 lg:mb-10 lg:grid lg:grid-cols-[1.05fr_1fr] lg:rounded-[28px]"
    >
      {/* Artwork: light trails over a night-time ground. */}
      <div className="relative h-52 overflow-hidden sm:h-64 lg:h-auto lg:min-h-[340px]" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_85%_115%,rgba(217,119,87,0.55),transparent_60%),radial-gradient(80%_60%_at_10%_0%,rgba(255,255,255,0.07),transparent_70%),linear-gradient(165deg,#2a1c15_0%,#120d0a_70%)]" />
        {/* A horizon and the road falling away from it. */}
        <div className="absolute inset-x-0 top-[58%] h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <svg className="absolute inset-x-0 bottom-0 h-[42%] w-full" viewBox="0 0 400 100" preserveAspectRatio="none">
          <path d="M170 0 L40 100 M230 0 L360 100" stroke="rgba(255,255,255,0.10)" strokeWidth="1" fill="none" />
          <path d="M200 0 L200 100" stroke="rgba(255,220,180,0.25)" strokeWidth="1.2" strokeDasharray="6 9" fill="none" />
        </svg>
        {/* The light trails - drifting slowly unless motion is reduced. */}
        {[
          { top: "30%", rotate: "-9deg", width: "2px", color: "rgba(255,226,190,0.95)", delay: "0s" },
          { top: "38%", rotate: "-7deg", width: "1.5px", color: "rgba(244,162,97,0.9)", delay: "-3s" },
          { top: "47%", rotate: "-11deg", width: "3px", color: "rgba(255,240,225,0.85)", delay: "-6s" },
          { top: "54%", rotate: "-6deg", width: "1.5px", color: "rgba(217,119,87,0.95)", delay: "-1.5s" },
          { top: "63%", rotate: "-13deg", width: "2px", color: "rgba(255,205,160,0.7)", delay: "-4.5s" },
        ].map((trail) => (
          <span
            key={trail.top}
            className="absolute -left-1/4 w-[150%] motion-safe:animate-[transfer-trail_9s_linear_infinite] motion-safe:[animation-delay:var(--trail-delay)]"
            style={
              {
                top: trail.top,
                height: trail.width,
                transform: `rotate(${trail.rotate})`,
                background: `linear-gradient(90deg, transparent 0%, ${trail.color} 45%, ${trail.color} 55%, transparent 100%)`,
                boxShadow: `0 0 12px 1px ${trail.color}`,
                "--trail-delay": trail.delay,
              } as React.CSSProperties
            }
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-t from-[#120d0a] via-transparent to-transparent lg:bg-gradient-to-r lg:from-transparent lg:via-transparent lg:to-[#120d0a]" />

        <p className="absolute left-5 top-5 flex items-center gap-2 sm:left-7 sm:top-7">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15 backdrop-blur-sm">
            <Zap className="h-4 w-4 fill-amber-300 text-amber-300" />
          </span>
          <span className="text-lg font-semibold tracking-tight">{offering.providerName}</span>
        </p>
      </div>

      <div className="relative flex flex-col justify-center gap-5 px-5 pb-6 pt-1 sm:px-7 sm:pb-8 lg:px-10 lg:py-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300/90">Airport transfers</p>
          <h3 className="mt-2 font-serif text-[1.75rem] leading-[1.1] text-balance sm:text-4xl">
            From the airport to your door, fully electric.
          </h3>
          {offering.description && (
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/75 sm:text-base">{offering.description}</p>
          )}
        </div>

        {offering.features.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {offering.features.map((feature) => {
              const Icon = featureIcon(feature);
              return (
                <li
                  key={feature}
                  className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/90 ring-1 ring-white/10 sm:text-sm"
                >
                  <Icon className="h-3.5 w-3.5 text-amber-300" aria-hidden />
                  {feature}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-t-white/10 pt-5">
          <p className="text-sm text-white/70">
            {offering.name}
            <span className="ml-2 font-serif text-2xl text-white">{price}</span>
          </p>
          <Link
            href={travelAddonHref(offering.category)}
            onClick={() =>
              trackAddonEvent({
                name: "transfer_offer_clicked",
                category: offering.category,
                surface: "homepage",
                offeringId: offering.id,
              })
            }
            className="focus-ring inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-brand-900 shadow-sm transition-transform duration-200 hover:bg-white/90 active:scale-[0.98]"
          >
            Add an airport transfer
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
