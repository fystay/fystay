-- CreateEnum
CREATE TYPE "ExtraFulfillmentStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'CONFIRMED', 'FAILED');

-- AlterTable
ALTER TABLE "BookingExtra" ADD COLUMN     "fulfillmentAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fulfillmentConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "fulfillmentError" TEXT,
ADD COLUMN     "fulfillmentReference" TEXT,
ADD COLUMN     "fulfillmentStatus" "ExtraFulfillmentStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "ExtraProvider" ADD COLUMN     "integration" TEXT NOT NULL DEFAULT 'email';

-- CreateIndex
CREATE INDEX "BookingExtra_fulfillmentStatus_idx" ON "BookingExtra"("fulfillmentStatus");


-- Backfill: extras whose provider email already went out were handed off;
-- paid extras whose email never sent were a silent failed handoff before
-- this status existed, so surface them for a retry instead of leaving them
-- looking untouched.
UPDATE "BookingExtra" SET "fulfillmentStatus" = 'SENT', "fulfillmentAttempts" = 1
WHERE "sentToProviderAt" IS NOT NULL;

UPDATE "BookingExtra"
SET "fulfillmentStatus" = 'FAILED',
    "fulfillmentError" = 'Provider handoff was not recorded before fulfillment tracking existed - retry to send it.'
WHERE "status" = 'PAID' AND "sentToProviderAt" IS NULL;
