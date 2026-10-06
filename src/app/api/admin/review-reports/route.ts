import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * Lists ReviewReport rows for the admin moderation queue
 * (/admin/review-reports) - the "surfacing it in an admin queue" half of
 * the report route's own comment (src/app/api/reviews/[id]/report/route.ts).
 * Defaults to just the OPEN ones (what an admin actually needs to work
 * through day to day); ?status=all shows the full history including past
 * decisions, and ?status=DISMISSED/ACTIONED shows just one outcome.
 */
async function getHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const statusParam = new URL(request.url).searchParams.get("status");
  const status =
    statusParam === "all"
      ? undefined
      : statusParam === "DISMISSED" || statusParam === "ACTIONED" || statusParam === "OPEN"
        ? statusParam
        : "OPEN";

  const reports = await prisma.reviewReport.findMany({
    where: status ? { status } : undefined,
    include: {
      reporter: { select: { name: true, email: true } },
      review: {
        select: {
          id: true,
          rating: true,
          comment: true,
          status: true,
          author: { select: { name: true } },
          listing: { select: { id: true, title: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ reports });
}

export const GET = withApiErrorHandling(getHandler);
