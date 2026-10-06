import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";

async function deleteHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const { id, requestId } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const changeRequest = await prisma.bookingChangeRequest.findUnique({
    where: { id: requestId },
    include: { booking: true },
  });

  if (!changeRequest || changeRequest.bookingId !== id) {
    return NextResponse.json({ error: "Change request not found" }, { status: 404 });
  }
  if (changeRequest.booking.guestId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (changeRequest.status !== "PENDING") {
    return NextResponse.json(
      { error: "This request has already been responded to" },
      { status: 409 },
    );
  }

  await prisma.bookingChangeRequest.delete({ where: { id: requestId } });

  return NextResponse.json({ ok: true });
}

export const DELETE = withApiErrorHandling(deleteHandler);
