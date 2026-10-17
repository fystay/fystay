import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";
import { isListingHost } from "@/lib/listingOnboarding";
import { smartPricingSettingsError } from "@/lib/dynamicPricing";
import { CURRENT_DYNAMIC_POLICY } from "@/lib/pricingPolicy";

/**
 * A host's smart-pricing settings for one listing. Only the listing's own
 * host can change them - not an admin, not FYStay - because turning smart
 * pricing on lets FYStay change the price guests pay and the host earns.
 * Turning it on - or keeping it on after the dynamic policy's version
 * changed - needs the host's explicit agreement (`consent: true`) to the
 * current version, recorded with the time and version, and a minimum
 * payout; every limit is checked here whatever the form already checked.
 */

const pence = z.number().int().positive().max(1_000_000).nullable();
const settingsSchema = z.object({
  enabled: z.boolean(),
  autoApply: z.boolean(),
  consent: z.boolean().optional(),
  minPayoutCents: pence,
  targetPayoutCents: pence,
  minPriceCents: pence,
  maxPriceCents: pence,
  maxAdjustmentPercent: z.number().int().min(0).max(100).nullable(),
});

async function putHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { id: true, hostId: true, hostInvitationId: true, preparedById: true, propertyType: true, pricePerNightCents: true, weekendPricePerNightCents: true, weeklyDiscountPercent: true, monthlyDiscountPercent: true, lastMinuteDiscountPercent: true, smartPricingConsentAt: true, smartPricingConsentPolicyVersion: true, smartPricingEnabled: true },
  });
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isListingHost(session, listing)) return NextResponse.json({ error: "Only the listing's host can change smart pricing" }, { status: 403 });
  if (listing.propertyType === "HOTEL") return NextResponse.json({ error: "Smart pricing isn't available for hotels' room types yet" }, { status: 400 });

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const input = parsed.data;

  // Agreement is to one policy version: turning it on, or staying on under a newer version, asks again.
  const needsConsent = input.enabled && (!listing.smartPricingEnabled || listing.smartPricingConsentPolicyVersion !== CURRENT_DYNAMIC_POLICY.version);
  if (needsConsent && input.consent !== true) {
    return NextResponse.json({ error: "Please confirm you agree to smart pricing and FYStay's commission terms before turning it on" }, { status: 400 });
  }

  const settings = {
    enabled: input.enabled,
    autoApply: input.autoApply,
    minHostPayoutPerNightCents: input.minPayoutCents,
    targetHostPayoutPerNightCents: input.targetPayoutCents,
    minGuestPricePerNightCents: input.minPriceCents,
    maxGuestPricePerNightCents: input.maxPriceCents,
    maxAdjustmentPercent: input.maxAdjustmentPercent,
  };
  // Every limit, including whether the minimum payout can be met on every
  // stay given the host's own price and discounts (minimumPayoutError).
  const error = smartPricingSettingsError(settings, listing);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const updated = await prisma.listing.update({
    where: { id },
    data: {
      smartPricingEnabled: input.enabled,
      smartPricingAutoApply: input.autoApply,
      // Each agreement is recorded afresh, with the policy version agreed to.
      smartPricingConsentAt: needsConsent ? new Date() : input.enabled ? listing.smartPricingConsentAt : null,
      smartPricingConsentPolicyVersion: needsConsent ? CURRENT_DYNAMIC_POLICY.version : input.enabled ? listing.smartPricingConsentPolicyVersion : null,
      smartPricingMinPayoutCents: input.minPayoutCents,
      smartPricingTargetPayoutCents: input.targetPayoutCents,
      smartPricingMinPriceCents: input.minPriceCents,
      smartPricingMaxPriceCents: input.maxPriceCents,
      smartPricingMaxAdjustmentPercent: input.maxAdjustmentPercent,
    },
    select: {
      smartPricingEnabled: true,
      smartPricingAutoApply: true,
      smartPricingConsentAt: true,
      smartPricingConsentPolicyVersion: true,
      smartPricingMinPayoutCents: true,
      smartPricingTargetPayoutCents: true,
      smartPricingMinPriceCents: true,
      smartPricingMaxPriceCents: true,
      smartPricingMaxAdjustmentPercent: true,
    },
  });
  return NextResponse.json({ settings: updated });
}

export const PUT = withApiErrorHandling(putHandler);
