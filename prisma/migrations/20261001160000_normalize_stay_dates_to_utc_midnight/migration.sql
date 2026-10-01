-- Stay dates are calendar dates stored as UTC midnight (see src/lib/stayDates.ts).
-- Until this release the booking/calendar UI sent the guest's or host's local
-- midnight instead (a UK date in summer arrived as 23:00 the previous day), so
-- those rows are rounded to the nearest UTC midnight - the date the person
-- actually picked. Rows already at midnight are left exactly as they are.

UPDATE "Booking"
SET "checkIn" = date_trunc('day', "checkIn" + interval '12 hours'),
    "checkOut" = date_trunc('day', "checkOut" + interval '12 hours')
WHERE "checkIn" <> date_trunc('day', "checkIn")
   OR "checkOut" <> date_trunc('day', "checkOut");

UPDATE "AvailabilityBlock"
SET "startDate" = date_trunc('day', "startDate" + interval '12 hours'),
    "endDate" = date_trunc('day', "endDate" + interval '12 hours')
WHERE "startDate" <> date_trunc('day', "startDate")
   OR "endDate" <> date_trunc('day', "endDate");

UPDATE "BookingChangeRequest"
SET "requestedCheckIn" = date_trunc('day', "requestedCheckIn" + interval '12 hours'),
    "requestedCheckOut" = date_trunc('day', "requestedCheckOut" + interval '12 hours'),
    "originalCheckIn" = date_trunc('day', "originalCheckIn" + interval '12 hours'),
    "originalCheckOut" = date_trunc('day', "originalCheckOut" + interval '12 hours')
WHERE "requestedCheckIn" <> date_trunc('day', "requestedCheckIn")
   OR "requestedCheckOut" <> date_trunc('day', "requestedCheckOut")
   OR "originalCheckIn" <> date_trunc('day', "originalCheckIn")
   OR "originalCheckOut" <> date_trunc('day', "originalCheckOut");
