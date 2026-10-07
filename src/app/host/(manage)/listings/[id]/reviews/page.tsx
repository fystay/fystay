import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, MessageSquare } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { StarRating } from "@/components/ui/StarRating";
import { ReviewSummary } from "@/components/ReviewSummary";
import { HostReviewResponseForm } from "@/components/HostReviewResponseForm";
import { REVIEW_CATEGORIES, type ReviewCategory } from "@/lib/reviews";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await prisma.listing.findUnique({ where: { id }, select: { title: true } });
  return {
    title: listing ? `Reviews · ${listing.title}` : "Reviews",
    robots: { index: false },
  };
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

const CATEGORY_LABEL: Record<ReviewCategory, string> = {
  cleanliness: "Cleanliness",
  accuracy: "Accuracy",
  communication: "Communication",
  location: "Location",
  value: "Value",
};

const CATEGORY_FIELD: Record<ReviewCategory, "cleanlinessRating" | "accuracyRating" | "communicationRating" | "locationRating" | "valueRating"> = {
  cleanliness: "cleanlinessRating",
  accuracy: "accuracyRating",
  communication: "communicationRating",
  location: "locationRating",
  value: "valueRating",
};

export default async function HostListingReviewsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=/host/listings/${id}/reviews`);

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      reviews: {
        where: { status: "PUBLISHED" },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!listing) notFound();
  if (listing.hostId !== session.user.id) redirect("/host/dashboard");

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link
        href="/host/dashboard"
        className="focus-ring inline-flex items-center gap-1 rounded-lg text-sm font-medium text-stone-500 hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to your listings
      </Link>

      <h1 className="mt-4 text-2xl font-bold text-foreground">Reviews</h1>
      <p className="mt-1 text-sm text-stone-500">{listing.title}</p>

      {listing.reviews.length === 0 ? (
        <Card className="mt-8 flex flex-col items-center gap-3 p-12 text-center">
          <MessageSquare className="h-8 w-8 text-stone-300" />
          <p className="font-medium text-foreground">No reviews yet</p>
          <p className="max-w-sm text-sm text-stone-500">
            Reviews from guests appear here once they&apos;ve completed a stay.
          </p>
        </Card>
      ) : (
        <>
          <Card className="mt-6 p-5">
            <ReviewSummary reviews={listing.reviews} />
          </Card>

          <ul className="mt-6 flex flex-col gap-4">
            {listing.reviews.map((review) => {
              const ratedCategories = REVIEW_CATEGORIES.filter(
                (category) => review[CATEGORY_FIELD[category]] !== null,
              );
              return (
                <Card key={review.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">{review.author.name}</p>
                      <span className="text-xs text-stone-500">
                        {dateFormatter.format(review.createdAt)}
                      </span>
                    </div>
                    <StarRating rating={review.rating} size={14} />
                  </div>

                  <p className="mt-2 text-sm text-stone-700">{review.comment}</p>

                  {ratedCategories.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
                      {ratedCategories.map((category) => (
                        <span key={category}>
                          {CATEGORY_LABEL[category]}: {review[CATEGORY_FIELD[category]]}/5
                        </span>
                      ))}
                    </div>
                  )}

                  <HostReviewResponseForm reviewId={review.id} initialResponse={review.hostResponse} />
                </Card>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
