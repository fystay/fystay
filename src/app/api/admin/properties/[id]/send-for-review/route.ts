import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/apiError";
import { escapeHtml } from "@/lib/emailLayout";
import {
  PUBLICATION_LISTING_SELECT,
  publicationState,
  recordReviewEvent,
  sendReviewNotice,
} from "@/lib/listingOnboarding";

const bodySchema = z.object({
  // An optional note shown to the host with the review, e.g. what to check closely.
  message: z.string().trim().max(1000).optional(),
});

const INFO_BLOCKERS = new Set(["missing_title", "missing_description", "missing_photos", "missing_price", "missing_location"]);

/**
 * Admin-only: hands a prepared draft to the host for review - from DRAFT,
 * or again after the host asked for changes. The listing must have its
 * basic details first, so the host never reviews a half-empty page.
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const listing = await prisma.listing.findUnique({ where: { id }, select: PUBLICATION_LISTING_SELECT });
  if (!listing || !listing.preparedById) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (listing.reviewStatus !== "DRAFT" && listing.reviewStatus !== "CHANGES_REQUESTED") {
    return NextResponse.json({ error: "This listing isn't waiting on FYStay - it's already with the host or approved." }, { status: 409 });
  }
  const missing = publicationState(listing).blockers.filter((b) => INFO_BLOCKERS.has(b.code));
  if (missing.length > 0) {
    return NextResponse.json({ error: `Finish the details first: ${missing.map((b) => b.message).join(" ")}` }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.listing.update({ where: { id }, data: { reviewStatus: "AWAITING_HOST_REVIEW" } });
    await recordReviewEvent(tx, {
      listingId: id,
      type: "SENT_FOR_REVIEW",
      revision: listing.materialRevision,
      actor: { id: session.user.id, role: session.user.role },
      note: parsed.data.message || null,
    });
  });

  // Hosts with access hear about it now; an invited owner sees it as soon
  // as they accept their invitation.
  if (!listing.hostInvitationId) {
    await sendReviewNotice(listing.host, {
      subject: "Please review your FYStay listing",
      heading: "Your listing is ready to review",
      intro: `FYStay has prepared "${escapeHtml(listing.title)}" for you. Please check every detail, then approve it or tell us what to change. It stays private until you approve it.`,
      cta: { label: "Review my listing", path: `/host/listings/${id}/review` },
    });
  }

  return NextResponse.json({ ok: true });
}

export const POST = withApiErrorHandling(postHandler);
