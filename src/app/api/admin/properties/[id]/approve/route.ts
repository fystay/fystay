import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/apiError";
import { escapeHtml } from "@/lib/emailLayout";
import {
  PUBLICATION_LISTING_SELECT,
  fystayListingReviewRequired,
  publicationState,
  recordReviewEvent,
  sendReviewNotice,
} from "@/lib/listingOnboarding";
import { awaitsFystayReview } from "@/lib/listingReview";

/**
 * Admin-only: FYStay's one-off approval of a listing a host created
 * themselves (see fystayListingReviewRequired). It's stored in the same
 * approval fields a prepared listing uses, then the listing goes live at
 * once if nothing else stops it - the host already asked for that when
 * they created it. Otherwise the host is told what's left.
 */
async function postHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const listing = await prisma.listing.findUnique({ where: { id }, select: PUBLICATION_LISTING_SELECT });
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!awaitsFystayReview(listing, fystayListingReviewRequired())) {
    return NextResponse.json({ error: "This listing isn't waiting for FYStay's review." }, { status: 409 });
  }

  const now = new Date();
  const approved = { ...listing, approvedRevision: listing.materialRevision };
  const goLive = publicationState(approved).blockers.length === 0;
  const actor = { id: session.user.id, role: session.user.role };

  await prisma.$transaction(async (tx) => {
    const updated = await tx.listing.updateMany({
      // Only if nobody approved it in the meantime.
      where: { id, approvedRevision: null },
      data: {
        approvedRevision: listing.materialRevision,
        approvedAt: now,
        approvedById: session.user.id,
        ...(goLive && { published: true }),
      },
    });
    if (updated.count === 0) return;
    await recordReviewEvent(tx, { listingId: id, type: "APPROVED", revision: listing.materialRevision, actor });
    if (goLive) await recordReviewEvent(tx, { listingId: id, type: "PUBLISHED", revision: listing.materialRevision, actor });
  });

  await sendReviewNotice(listing.host, goLive
    ? {
        subject: "Your FYStay listing is live",
        heading: "Your listing is live",
        intro: `FYStay has checked "${escapeHtml(listing.title)}" and it's now live - guests can find and book it.`,
        cta: { label: "See my listings", path: "/host/listings" },
      }
    : {
        subject: "FYStay has approved your listing",
        heading: "Your listing is approved",
        intro: `FYStay has checked "${escapeHtml(listing.title)}". There's still something to finish before it can go live - your listings page shows what.`,
        cta: { label: "See my listings", path: "/host/listings" },
      });

  return NextResponse.json({ ok: true, published: goLive });
}

export const POST = withApiErrorHandling(postHandler);
