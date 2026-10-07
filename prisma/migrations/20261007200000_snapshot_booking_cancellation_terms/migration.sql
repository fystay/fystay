-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cancellationPolicy" "CancellationPolicyKind",
ADD COLUMN     "customCancellationCutoffDays" INTEGER,
ADD COLUMN     "customCancellationRefundPercent" INTEGER;
