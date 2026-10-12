import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * The listing's host replaces their private calendar export link, e.g. if
 * it was shared by mistake. The old link stops working at once; calendars
 * subscribed to it need the new one.
 */
async function postHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const listing = await prisma.listing.findUnique({ where: { id }, select: { hostId: true } });
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  if (listing.hostId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await prisma.listing.update({
    where: { id },
    data: { icalExportToken: randomBytes(24).toString("base64url") },
    select: { icalExportToken: true },
  });
  return NextResponse.json({ token: updated.icalExportToken });
}

export const POST = withApiErrorHandling(postHandler);
