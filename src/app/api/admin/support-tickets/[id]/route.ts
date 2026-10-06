import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";

/** A ticket's full thread plus its linked context (about-user/booking), for the admin detail/reply page. */
async function getHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      openedBy: { select: { id: true, name: true, email: true } },
      aboutUser: { select: { id: true, name: true, email: true } },
      booking: { select: { id: true, reference: true, listing: { select: { title: true } } } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { sender: { select: { id: true, name: true } } },
      },
    },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ticket });
}

export const GET = withApiErrorHandling(getHandler);
