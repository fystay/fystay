import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/apiError";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import {
  draftListingWithAi,
  isListingAiDraftConfigured,
  ListingAiDraftError,
  MAX_OWNER_NOTES_LENGTH,
} from "@/lib/listingAiDraft";

const bodySchema = z.object({
  notes: z
    .string()
    .trim()
    .min(20, "Paste a bit more of what the owner told you (at least 20 characters).")
    .max(MAX_OWNER_NOTES_LENGTH, `Keep the notes under ${MAX_OWNER_NOTES_LENGTH.toLocaleString("en-GB")} characters.`),
});

/**
 * Admin-only: an AI first draft of a prepared listing's title, description
 * and amenities from the owner's notes. Returns the draft without saving
 * it - the admin panel saves through the listing's normal PATCH, so the
 * usual validation and approval rules apply. Only for listings FYStay
 * prepared, like the rest of /admin/properties.
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isListingAiDraftConfigured()) {
    return NextResponse.json({ error: "AI drafting isn't set up yet." }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { preparedById: true, city: true, propertyType: true },
  });
  if (!listing || !listing.preparedById) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rateLimit = await checkRateLimit({ key: `listing-ai-draft:${session.user.id}`, limit: 30, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  try {
    const draft = await draftListingWithAi({ notes: parsed.data.notes, city: listing.city, propertyType: listing.propertyType });
    return NextResponse.json({ draft });
  } catch (error) {
    if (error instanceof ListingAiDraftError) return NextResponse.json({ error: error.message }, { status: 422 });
    throw error;
  }
}

export const POST = withApiErrorHandling(postHandler);
