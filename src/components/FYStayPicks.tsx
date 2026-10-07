"use client";

import { useMemo } from "react";
import { Footprints, MapPin, Sparkles } from "lucide-react";
import type { LocalRecommendation } from "@/lib/localData/recommendationEngine";
import { scoreRecommendation } from "@/lib/localData/recommendationEngine";
import type { MoodKey } from "@/lib/moods";
import { describeWhyRecommended } from "@/lib/localData/whyRecommended";
import { PLACE_CATEGORY_LABEL } from "@/lib/placeCategoryDisplay";
import { EDITORIAL_TAG_LABEL } from "@/lib/editorialTagDisplay";
import { PlaceCategoryArt } from "@/components/PlaceCategoryArt";
import { Badge } from "@/components/ui/Badge";

const PRICE_LABEL: Record<number, string> = { 1: "£", 2: "££", 3: "£££", 4: "££££" };
const CARD_COUNT = 10;

/**
 * The premium concierge's headline recommendations: a horizontal-scroll
 * carousel of large cards, each with generated category art, the
 * editorial or OSM description, real distance/walk time when a guest
 * arrived via a specific listing, a price indicator only when one is
 * actually known, and a short "why FYStay recommends it" line.
 *
 * A client component so the "Personalised Experience" picker can re-sort
 * this list instantly: `mood` and `rainy` feed the exact same pure
 * scoreRecommendation function the server used to build the baseline
 * order, so picking a preference never needs a round trip.
 */
export function FYStayPicks({
  recommendations,
  mood,
  rainy,
}: {
  recommendations: LocalRecommendation[];
  mood: MoodKey | null;
  rainy: boolean;
}) {
  const sorted = useMemo(() => {
    return [...recommendations]
      .map((rec) => ({ ...rec, score: scoreRecommendation(rec, { origin: null, weather: { rainy }, mood, now: new Date() }) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, CARD_COUNT);
  }, [recommendations, mood, rainy]);

  if (sorted.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <p className="text-lg font-semibold text-foreground">FYStay Picks</p>
      </div>
      <p className="mt-1.5 max-w-2xl text-sm text-stone-600">
        Our own shortlist, ranked for you - not just a list of everything nearby.
      </p>

      <div className="relative mt-5 h-[23rem] w-full">
        {/* Focusable and labelled: the cards hold no links, so without this a
            keyboard user could never scroll the row to see past the first few. */}
        <div
          role="region"
          aria-label="FYStay Picks"
          tabIndex={0}
          className="focus-ring absolute inset-0 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain scroll-smooth rounded-2xl pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {sorted.map((rec) => (
            <article
              key={rec.id}
              className="flex w-72 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-[var(--shadow-card)]"
            >
              <PlaceCategoryArt category={rec.category} className="h-36 w-full" />
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">
                    {PLACE_CATEGORY_LABEL[rec.category]}
                  </p>
                  {rec.priceLevel && (
                    <span className="text-xs font-semibold text-stone-500">{PRICE_LABEL[rec.priceLevel] ?? ""}</span>
                  )}
                </div>
                <p className="mt-1 font-semibold text-foreground">{rec.name}</p>
                {rec.description && (
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-stone-600">{rec.description}</p>
                )}

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {rec.editorialTag && <Badge variant="brand">{EDITORIAL_TAG_LABEL[rec.editorialTag]}</Badge>}
                  {rec.familyFriendly && <Badge variant="neutral">Family friendly</Badge>}
                  {rec.dogFriendly && <Badge variant="neutral">Dog friendly</Badge>}
                </div>

                {(rec.distanceMiles !== null || rec.walkMinutes !== null) && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                    {rec.distanceMiles !== null && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                        {rec.distanceMiles} mi
                      </span>
                    )}
                    {rec.walkMinutes !== null && (
                      <span className="flex items-center gap-1">
                        <Footprints className="h-3 w-3 shrink-0" aria-hidden />
                        ~{rec.walkMinutes} min walk
                      </span>
                    )}
                  </div>
                )}

                <p className="mt-auto pt-3 text-xs italic leading-relaxed text-brand-800">
                  {describeWhyRecommended(rec)}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
