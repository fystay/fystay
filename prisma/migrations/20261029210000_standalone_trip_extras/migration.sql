-- A trip extra (e.g. an airport transfer) can be bought on its own, without a stay.
ALTER TABLE "BookingExtra" ALTER COLUMN "bookingId" DROP NOT NULL;
ALTER TABLE "BookingExtra" ADD COLUMN "guestId" TEXT;
ALTER TABLE "BookingExtra" ADD COLUMN "contactName" TEXT;
ALTER TABLE "BookingExtra" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "BookingExtra" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "BookingExtra" ADD COLUMN "travelAt" TIMESTAMP(3);

ALTER TABLE "BookingExtra" ADD CONSTRAINT "BookingExtra_guestId_fkey"
  FOREIGN KEY ("guestId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every extra belongs to a stay or, standalone, to the guest who bought it - never both, never neither.
ALTER TABLE "BookingExtra" ADD CONSTRAINT "BookingExtra_stay_or_guest_check"
  CHECK (("bookingId" IS NOT NULL) <> ("guestId" IS NOT NULL));

CREATE INDEX "BookingExtra_guestId_idx" ON "BookingExtra"("guestId");
