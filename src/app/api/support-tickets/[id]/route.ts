import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isTicketOpener } from "@/lib/supportTickets";
import { withApiErrorHandling } from "@/lib/apiError";

/** A ticket's full thread - visible only to the person who opened it or an admin. */
async function getHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      aboutUser: { select: { id: true, name: true } },
      booking: { select: { id: true, reference: true, listing: { select: { title: true } } } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, isAdminReply: true, createdAt: true, senderId: true },
      },
    },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isTicketOpener(ticket, session.user.id) && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ ticket });
}

export const GET = withApiErrorHandling(getHandler);
