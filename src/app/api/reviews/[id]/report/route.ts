import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canReportReview } from "@/lib/reviews";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";

const REPORT_REASONS = ["spam", "offensive", "not_genuine", "other"] as const;

const reportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).optional(),
});

/**
 * Lets a guest flag a review for moderation attention. This only records
 * the report (OPEN status) - dismissing it, removing the review, or
 * surfacing it in an admin queue is a later moderation feature, not built
 * here, but the report itself is real and persisted now.
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit({
    key: `reviews:report:${session.user.id}`,
    limit: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const body = await request.json();
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const review = await prisma.review.findUnique({ where: { id } });
  if (!review || review.status === "REMOVED") {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  const existingReport = await prisma.reviewReport.findUnique({
    where: { reviewId_reporterId: { reviewId: id, reporterId: session.user.id } },
  });
  if (
    !canReportReview({
      reviewAuthorId: review.authorId,
      currentUserId: session.user.id,
      alreadyReported: Boolean(existingReport),
    })
  ) {
    return NextResponse.json(
      {
        error:
          review.authorId === session.user.id
            ? "You can't report your own review"
            : "You've already reported this review",
      },
      { status: 409 },
    );
  }

  const report = await prisma.reviewReport.create({
    data: {
      reviewId: id,
      reporterId: session.user.id,
      reason: parsed.data.reason,
      details: parsed.data.details,
    },
  });

  return NextResponse.json({ report }, { status: 201 });
}

export const POST = withApiErrorHandling(postHandler);
