import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";

// Without `saved` this toggles (the heart's own tap). With it, it sets that
// state and is safe to repeat - used to finish a save a guest started
// before signing in (see SaveButton), which must never undo an earlier save.
const toggleWishlistSchema = z.object({
  listingId: z.string().min(1),
  saved: z.boolean().optional(),
});

async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = toggleWishlistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const listing = await prisma.listing.findUnique({
    where: { id: parsed.data.listingId },
    select: { id: true },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const existing = await prisma.savedListing.findUnique({
    where: {
      userId_listingId: { userId: session.user.id, listingId: parsed.data.listingId },
    },
  });

  const wantSaved = parsed.data.saved ?? !existing;
  if (existing && wantSaved) return NextResponse.json({ saved: true });
  if (!existing && !wantSaved) return NextResponse.json({ saved: false });

  if (existing) {
    await prisma.savedListing.delete({ where: { id: existing.id } });
    return NextResponse.json({ saved: false });
  }

  await prisma.savedListing.create({
    data: { userId: session.user.id, listingId: parsed.data.listingId },
  });
  return NextResponse.json({ saved: true }, { status: 201 });
}

export const POST = withApiErrorHandling(postHandler);
