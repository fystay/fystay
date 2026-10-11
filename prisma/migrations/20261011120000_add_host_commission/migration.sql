-- FYStay's 10% commission, taken from the host's payout (see
-- HOST_COMMISSION_RATE in src/lib/pricing.ts). Older bookings carried a
-- guest service fee instead and keep 0 here.
ALTER TABLE "Booking" ADD COLUMN "hostCommissionCents" INTEGER NOT NULL DEFAULT 0;
