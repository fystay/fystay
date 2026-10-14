-- Smart pricing and versioned commission policies (src/lib/pricingPolicy.ts,
-- src/lib/dynamicPricing.ts). Additive only: every new column is nullable or
-- defaults to "off", so existing listings keep the fixed-10% price and
-- existing bookings keep their stored amounts exactly as they are.

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "basePriceSubtotalCents" INTEGER,
ADD COLUMN     "commissionRateBps" INTEGER,
ADD COLUMN     "priceDecisionId" TEXT,
ADD COLUMN     "pricingPolicyVersion" TEXT,
ADD COLUMN     "stripeProcessingFeeCents" INTEGER;

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "smartPricingAutoApply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smartPricingConsentAt" TIMESTAMP(3),
ADD COLUMN     "smartPricingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smartPricingMaxAdjustmentPercent" INTEGER,
ADD COLUMN     "smartPricingMaxPriceCents" INTEGER,
ADD COLUMN     "smartPricingMinPayoutCents" INTEGER,
ADD COLUMN     "smartPricingMinPriceCents" INTEGER,
ADD COLUMN     "smartPricingTargetPayoutCents" INTEGER;

-- CreateTable
CREATE TABLE "PriceDecision" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "conversionModelId" TEXT,
    "policyVersion" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "proposedAdjustmentPercent" INTEGER NOT NULL,
    "adjustmentPercent" INTEGER NOT NULL,
    "baseAccommodationCents" INTEGER NOT NULL,
    "chosenAccommodationCents" INTEGER NOT NULL,
    "hostPayoutCents" INTEGER NOT NULL,
    "platformFeeCents" INTEGER NOT NULL,
    "estimatedContributionCents" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,

    CONSTRAINT "PriceDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceDecision_listingId_createdAt_idx" ON "PriceDecision"("listingId", "createdAt");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_priceDecisionId_fkey" FOREIGN KEY ("priceDecisionId") REFERENCES "PriceDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceDecision" ADD CONSTRAINT "PriceDecision_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Like every app table: no access through Supabase's public API roles.
ALTER TABLE "PriceDecision" ENABLE ROW LEVEL SECURITY;
