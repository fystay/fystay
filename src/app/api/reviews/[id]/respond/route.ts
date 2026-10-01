import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canRespondToReview } from "@/lib/reviews";
import { withApiErrorHandling } from "@/lib/apiError";

const respondSchema = z.object({
  response: z.string().trim().min(1).max(2000),
});

/** A host's public reply to a review left on one of their listings. */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const review = await prisma.review.findUnique({
    where: { id },
    include: { listing: { select: { hostId: true } } },
  });
  if (!review || review.status === "REMOVED") {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }
  if (!canRespondToReview({ listingHostId: review.listing.hostId, currentUserId: session.user.id })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await prisma.review.update({
    where: { id },
    data: { hostResponse: parsed.data.response, hostRespondedAt: new Date() },
  });

  return NextResponse.json({ review: updated });
}

export const POST = withApiErrorHandling(postHandler);
