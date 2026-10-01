import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canReviewBooking } from "@/lib/reviews";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";

const categoryRating = z.number().int().min(1).max(5).optional();

const createReviewSchema = z.object({
  bookingId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z
    .string()
    .min(10, "Reviews need to be at least 10 characters.")
    .max(2000, "Reviews can't be longer than 2000 characters."),
  cleanlinessRating: categoryRating,
  accuracyRating: categoryRating,
  communicationRating: categoryRating,
  locationRating: categoryRating,
  valueRating: categoryRating,
});

async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // One review per booking is already enforced below (canReviewBooking) -
  // this just caps how many attempts (rejected or not) a single guest can
  // fire at the endpoint in a burst.
  const rateLimit = await checkRateLimit({
    key: `reviews:create:${session.user.id}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const body = await request.json();
  const parsed = createReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const booking = await prisma.booking.findUnique({
    where: { id: parsed.data.bookingId },
    include: { review: true },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.guestId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canReviewBooking(booking)) {
    return NextResponse.json(
      { error: "This stay can't be reviewed yet." },
      { status: 409 },
    );
  }

  const review = await prisma.review.create({
    data: {
      rating: parsed.data.rating,
      comment: parsed.data.comment,
      cleanlinessRating: parsed.data.cleanlinessRating,
      accuracyRating: parsed.data.accuracyRating,
      communicationRating: parsed.data.communicationRating,
      locationRating: parsed.data.locationRating,
      valueRating: parsed.data.valueRating,
      listingId: booking.listingId,
      authorId: session.user.id,
      bookingId: booking.id,
    },
  });

  return NextResponse.json({ review }, { status: 201 });
}

export const POST = withApiErrorHandling(postHandler);
