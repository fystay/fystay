import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/apiError";
import { escapeHtml } from "@/lib/emailLayout";
import { approvalData, isListingHost, recordReviewEvent, sendReviewNotice } from "@/lib/listingOnboarding";

const reviewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    // The revision the host was looking at. If FYStay changed anything since,
    // the approval is refused rather than applied to something unseen.
    revision: z.number().int().min(1),
    confirmed: z.literal(true, { message: "Tick the box to confirm you've checked the listing." }),
  }),
  z.object({
    action: z.literal("request_changes"),
    note: z.string().trim().min(5, "Tell FYStay what needs changing.").max(2000),
  }),
]);

/**
 * The host's explicit decision on a listing FYStay prepared: approve the
 * exact revision they reviewed, or ask for changes. Only the listing's own
 * host can do either - not an admin, and not by signing in, opening or
 * saving the listing. Approval records who, when and which revision
 * (with the material facts as approved); it doesn't publish anything.
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: { preparedBy: { select: { email: true, name: true } } },
  });
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isListingHost(session, listing)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!listing.preparedById) {
    return NextResponse.json({ error: "You created this listing yourself, so there's nothing to approve." }, { status: 409 });
  }

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const actor = { id: session.user.id, role: session.user.role };
  const now = new Date();

  if (parsed.data.action === "approve") {
    if (listing.reviewStatus !== "AWAITING_HOST_REVIEW" && listing.reviewStatus !== "CHANGES_REQUESTED") {
      return NextResponse.json(
        {
          error:
            listing.reviewStatus === "HOST_APPROVED"
              ? "You've already approved this version."
              : "FYStay is still preparing this listing - you'll be asked to review it when it's ready.",
        },
        { status: 409 },
      );
    }
    if (parsed.data.revision !== listing.materialRevision) {
      return NextResponse.json(
        { error: "The listing changed while you were reviewing it. Please check the latest version, then approve.", code: "stale_revision" },
        { status: 409 },
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.listing.update({ where: { id }, data: approvalData(listing, session.user.id, now) });
      await recordReviewEvent(tx, { listingId: id, type: "APPROVED", revision: listing.materialRevision, actor });
    });
    if (listing.preparedBy) {
      await sendReviewNotice(listing.preparedBy, {
        subject: `Approved: ${listing.title}`,
        heading: "The host approved their listing",
        intro: `the host approved revision ${listing.materialRevision} of "${escapeHtml(listing.title)}". Check what's left before it can go live.`,
        cta: { label: "Open the property", path: `/admin/properties/${id}` },
      });
    }
    return NextResponse.json({ ok: true, approvedRevision: listing.materialRevision });
  }

  const { note } = parsed.data;
  if (listing.published) {
    return NextResponse.json(
      { error: "This listing is live. Edit it directly, or hide it first if something is wrong." },
      { status: 409 },
    );
  }
  if (listing.reviewStatus === "DRAFT") {
    return NextResponse.json({ error: "FYStay is still preparing this listing." }, { status: 409 });
  }
  await prisma.$transaction(async (tx) => {
    await tx.listing.update({ where: { id }, data: { reviewStatus: "CHANGES_REQUESTED" } });
    await recordReviewEvent(tx, {
      listingId: id,
      type: "CHANGES_REQUESTED",
      revision: listing.materialRevision,
      actor,
      note,
    });
  });
  if (listing.preparedBy) {
    await sendReviewNotice(listing.preparedBy, {
      subject: `Changes requested: ${listing.title}`,
      heading: "The host asked for changes",
      intro: `the host asked for changes to "${escapeHtml(listing.title)}": ${escapeHtml(note)}`,
      cta: { label: "Open the property", path: `/admin/properties/${id}` },
    });
  }
  return NextResponse.json({ ok: true });
}

export const POST = withApiErrorHandling(postHandler);
