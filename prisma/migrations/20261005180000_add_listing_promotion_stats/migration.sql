-- CreateTable
CREATE TABLE "ListingPromotionStat" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ListingPromotionStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListingPromotionStat_promotionId_day_key" ON "ListingPromotionStat"("promotionId", "day");

-- AddForeignKey
ALTER TABLE "ListingPromotionStat" ADD CONSTRAINT "ListingPromotionStat_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "ListingPromotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

