-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "icalSyncError" TEXT,
ADD COLUMN     "icalSyncFailedAt" TIMESTAMP(3);

