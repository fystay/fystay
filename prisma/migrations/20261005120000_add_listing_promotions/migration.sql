-- CreateEnum
CREATE TYPE "ListingPromotionStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "ListingPromotion" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "status" "ListingPromotionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "endedEarlyAt" TIMESTAMP(3),
    "stripeSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListingPromotion_stripeSessionId_key" ON "ListingPromotion"("stripeSessionId");

-- CreateIndex
CREATE INDEX "ListingPromotion_status_endsAt_idx" ON "ListingPromotion"("status", "endsAt");

-- CreateIndex
CREATE INDEX "ListingPromotion_listingId_idx" ON "ListingPromotion"("listingId");

-- CreateIndex
CREATE INDEX "ListingPromotion_hostId_idx" ON "ListingPromotion"("hostId");

-- AddForeignKey
ALTER TABLE "ListingPromotion" ADD CONSTRAINT "ListingPromotion_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingPromotion" ADD CONSTRAINT "ListingPromotion_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

