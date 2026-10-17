-- Location search filters listings by a latitude/longitude box.
CREATE INDEX IF NOT EXISTS "Listing_latitude_longitude_idx" ON "Listing"("latitude", "longitude");
