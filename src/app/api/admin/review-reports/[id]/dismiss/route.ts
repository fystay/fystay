import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActionReport } from "@/lib/reviews";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * An admin's call that a reported review didn't warrant action - the
 * review itself is left exactly as it was, only this report's own status
 * moves to DISMISSED so it drops out of the default (OPEN) queue.
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

  const updated = await prisma.reviewReport.update({
    where: { id },
    data: { status: "DISMISSED" },
  });

  return NextResponse.json({ report: updated });
}

export const POST = withApiErrorHandling(postHandler);
