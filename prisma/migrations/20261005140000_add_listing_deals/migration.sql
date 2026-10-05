-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "lastMinuteDiscountPercent" INTEGER;

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "lastMinuteDiscountPercent" INTEGER,
ADD COLUMN     "lastMinuteWindowDays" INTEGER,
ADD COLUMN     "priceChangedAt" TIMESTAMP(3),
ADD COLUMN     "priceDropFromCents" INTEGER,
ADD COLUMN     "priceDroppedAt" TIMESTAMP(3);

