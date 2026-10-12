-- Two property types guests can filter by: B&B and Lodge. Adding enum
-- values only; no existing row changes.
ALTER TYPE "PropertyType" ADD VALUE IF NOT EXISTS 'BED_AND_BREAKFAST' BEFORE 'OTHER';
ALTER TYPE "PropertyType" ADD VALUE IF NOT EXISTS 'LODGE' BEFORE 'OTHER';
