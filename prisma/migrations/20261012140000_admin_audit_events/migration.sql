-- CreateEnum
CREATE TYPE "AdminAuditAction" AS ENUM ('USER_SUSPENDED', 'USER_REINSTATED', 'USER_DELETED', 'LISTING_ASSIGNED');

-- CreateTable
CREATE TABLE "AdminAuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "AdminAuditAction" NOT NULL,
    "targetUserId" TEXT,
    "targetListingId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditEvent_targetUserId_createdAt_idx" ON "AdminAuditEvent"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditEvent_targetListingId_createdAt_idx" ON "AdminAuditEvent"("targetListingId", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminAuditEvent" ADD CONSTRAINT "AdminAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Deny-all for the Supabase API roles, like every other table.
ALTER TABLE "AdminAuditEvent" ENABLE ROW LEVEL SECURITY;
