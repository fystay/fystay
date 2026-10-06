import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActionReport } from "@/lib/reviews";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * An admin upholding a report: the reported review is taken down
 * (Review.status -> REMOVED, which every public read path already filters
 * out - see src/lib/reviews.ts and every listing/search/wishlist/home
 * query) and this report is marked ACTIONED.
 *
 * A review can carry more than one report (@@unique([reviewId, reporterId])
 * only stops the same guest reporting it twice, not different guests each
 * reporting it once). Once the review is gone, any of its OTHER still-OPEN
 * reports are moved to ACTIONED in the same transaction too, rather than
 * left OPEN forever: there's nothing left for an admin to decide on them
 * (the outcome they were asking for already happened) and dismissing them
 * would misrepresent that as "not actionable" when it was, in fact, acted
 * on - just via a different reporter's report on the same review.
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const report = await prisma.reviewReport.findUnique({ where: { id } });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
  if (!canActionReport(report.status)) {
    return NextResponse.json(
      { error: `This report is already ${report.status.toLowerCase()}` },
      { status: 409 },
    );
  }

  const [, updatedReport] = await prisma.$transaction([
    prisma.review.update({
      where: { id: report.reviewId },
      data: { status: "REMOVED" },
    }),
    prisma.reviewReport.update({
      where: { id: report.id },
      data: { status: "ACTIONED" },
    }),
    prisma.reviewReport.updateMany({
      where: { reviewId: report.reviewId, status: "OPEN", id: { not: report.id } },
      data: { status: "ACTIONED" },
    }),
  ]);

  return NextResponse.json({ report: updatedReport });
}

export const POST = withApiErrorHandling(postHandler);
