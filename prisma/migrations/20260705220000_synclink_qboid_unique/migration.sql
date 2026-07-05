-- Drop the plain index on qboId (superseded by the unique constraint below)
DROP INDEX IF EXISTS "SyncLink_qboId_idx";

-- Add unique constraint on qboId (NULL values remain non-unique per SQL standard,
-- so multiple unlinked SyncLinks with qboId = NULL are still allowed)
ALTER TABLE "SyncLink" ADD CONSTRAINT "SyncLink_qboId_key" UNIQUE ("qboId");
