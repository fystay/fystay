import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/AdminNav";
import { Badge } from "@/components/ui/Badge";
import { EndPromotionButton } from "@/components/admin/EndPromotionButton";
import { promotionPhase, SPOTLIGHT_SLOTS, type PromotionPhase } from "@/lib/listingPromotions";
import { formatDate, formatPrice } from "@/lib/format";
import { spotlightStatsFor } from "@/lib/spotlightStats";

export const metadata: Metadata = { title: "Spotlight", robots: { index: false } };

const PHASE_BADGE: Record<PromotionPhase, { label: string; variant: "success" | "brand" | "neutral" | "warning" }> = {
  live: { label: "Live", variant: "success" },
  scheduled: { label: "Scheduled", variant: "brand" },
  finished: { label: "Finished", variant: "neutral" },
  pending: { label: "Awaiting payment", variant: "warning" },
  cancelled: { label: "Abandoned", variant: "neutral" },
};

/**
 * Every Spotlight placement hosts have bought (see
 * src/lib/listingPromotions.ts) - what's live, what's coming, and what it
 * has earned - with a way to end one early.
 */
export default async function AdminPromotionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/promotions");
  if (session.user.role !== "ADMIN") redirect("/");

  const now = new Date();
  const promotions = await prisma.listingPromotion.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      days: true,
      priceCents: true,
      status: true,
      startsAt: true,
      endsAt: true,
      endedEarlyAt: true,
      paidAt: true,
      listing: { select: { id: true, title: true } },
      host: { select: { name: true, email: true } },
    },
  });

  const paid = promotions.filter((p) => p.status === "PAID");
  const stats = await spotlightStatsFor(paid.map((p) => p.id));
  const liveListings = new Set(paid.filter((p) => promotionPhase(p, now) === "live").map((p) => p.listing.id));
  const scheduledCount = paid.filter((p) => promotionPhase(p, now) === "scheduled").length;
  const revenueCents = paid.reduce((sum, p) => sum + p.priceCents, 0);

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Spotlight</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
        Paid placements in the homepage&apos;s Spotlight stays showcase, bought by hosts, with how often each was
        seen and clicked. Up to {SPOTLIGHT_SLOTS}{" "}
        listings at a time.
      </p>

      <div className="mt-6">
        <AdminNav active="/admin/promotions" />
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Live now", value: `${liveListings.size} of ${SPOTLIGHT_SLOTS}` },
          { label: "Scheduled", value: String(scheduledCount) },
          { label: "Paid to date", value: formatPrice(revenueCents) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      {promotions.length === 0 ? (
        <p className="mt-8 text-sm text-stone-500">No Spotlight placements yet.</p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl border border-border-subtle bg-surface">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-border-subtle text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Listing</th>
                <th className="px-4 py-2.5 font-medium">Host</th>
                <th className="px-4 py-2.5 font-medium">Dates</th>
                <th className="px-4 py-2.5 font-medium">Price</th>
                <th className="px-4 py-2.5 text-right font-medium">Views</th>
                <th className="px-4 py-2.5 text-right font-medium">Clicks</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {promotions.map((promotion) => {
                const phase = promotionPhase(promotion, now);
                const badge = PHASE_BADGE[phase];
                return (
                  <tr key={promotion.id}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/listings/${promotion.listing.id}`}
                        className="focus-ring rounded-sm font-medium text-foreground hover:text-brand-700"
                      >
                        {promotion.listing.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {promotion.host.name}
                      <span className="block text-xs text-stone-400">{promotion.host.email}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-stone-600">
                      {promotion.startsAt && promotion.endsAt
                        ? `${formatDate(promotion.startsAt)} – ${formatDate(promotion.endsAt)}`
                        : `${promotion.days} days`}
                      {promotion.endedEarlyAt && <span className="block text-xs text-stone-400">Ended early</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-stone-600">{formatPrice(promotion.priceCents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-stone-600">
                      {promotion.status === "PAID"
                        ? (stats.get(promotion.id)?.impressions ?? 0).toLocaleString("en-GB")
                        : "–"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-stone-600">
                      {promotion.status === "PAID"
                        ? (stats.get(promotion.id)?.clicks ?? 0).toLocaleString("en-GB")
                        : "–"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(phase === "live" || phase === "scheduled") && (
                        <EndPromotionButton id={promotion.id} listingTitle={promotion.listing.title} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
