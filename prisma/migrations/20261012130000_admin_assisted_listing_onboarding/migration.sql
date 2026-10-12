-- CreateEnum
CREATE TYPE "ListingReviewStatus" AS ENUM ('DRAFT', 'AWAITING_HOST_REVIEW', 'CHANGES_REQUESTED', 'HOST_APPROVED');

-- CreateEnum
CREATE TYPE "ListingReviewEventType" AS ENUM ('PREPARED', 'INVITATION_SENT', 'HOST_ACCESS_GRANTED', 'SENT_FOR_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'APPROVAL_INVALIDATED', 'PUBLISHED', 'UNPUBLISHED');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedRevision" INTEGER,
ADD COLUMN     "approvedSnapshot" JSONB,
ADD COLUMN     "hostInvitationId" TEXT,
ADD COLUMN     "materialRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "preparedById" TEXT,
ADD COLUMN     "reviewStatus" "ListingReviewStatus";

-- CreateTable
CREATE TABLE "HostInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "consentNote" TEXT NOT NULL,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingReviewEvent" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" "Role",
    "type" "ListingReviewEventType" NOT NULL,
    "revision" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HostInvitation_tokenHash_key" ON "HostInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "HostInvitation_email_idx" ON "HostInvitation"("email");

-- CreateIndex
CREATE INDEX "ListingReviewEvent_listingId_createdAt_idx" ON "ListingReviewEvent"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "Listing_preparedById_idx" ON "Listing"("preparedById");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_hostInvitationId_fkey" FOREIGN KEY ("hostInvitationId") REFERENCES "HostInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostInvitation" ADD CONSTRAINT "HostInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostInvitation" ADD CONSTRAINT "HostInvitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingReviewEvent" ADD CONSTRAINT "ListingReviewEvent_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingReviewEvent" ADD CONSTRAINT "ListingReviewEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

