-- AlterEnum
ALTER TYPE "CancellationPolicyKind" ADD VALUE 'NON_REFUNDABLE';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "weekendPricePerNightCents" INTEGER;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "weekendNights" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "weekendNightlyPriceCents" INTEGER;
