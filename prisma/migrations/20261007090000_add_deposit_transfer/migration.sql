-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "depositTransferId" TEXT,
ADD COLUMN     "depositTransferredAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_depositTransferId_key" ON "Booking"("depositTransferId");
