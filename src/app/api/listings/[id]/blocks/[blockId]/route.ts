import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";

async function deleteHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string; blockId: string }> },
) {
  const { id, blockId } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const block = await prisma.availabilityBlock.findUnique({
    where: { id: blockId },
    include: { listing: true },
  });
  if (!block || block.listingId !== id) {
    return NextResponse.json({ error: "Block not found" }, { status: 404 });
  }
  if (block.listing.hostId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.availabilityBlock.delete({ where: { id: blockId } });

  return NextResponse.json({ ok: true });
}

export const DELETE = withApiErrorHandling(deleteHandler);
