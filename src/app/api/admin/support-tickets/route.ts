import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { previewMessage } from "@/lib/messaging";
import type { SupportTicketStatus } from "@prisma/client";
import { withApiErrorHandling } from "@/lib/apiError";

const STATUS_VALUES: SupportTicketStatus[] = ["OPEN", "RESOLVED", "CLOSED"];

/**
 * Every support ticket, for the admin queue - defaults to OPEN (the ones
 * that actually need attention) rather than dumping the full history, same
 * reasoning as most support/moderation queues in this app. Pass
 * ?status=RESOLVED|CLOSED|ALL to see something else.
 */
async function getHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const statusParam = new URL(request.url).searchParams.get("status")?.toUpperCase() ?? "OPEN";
  const status = STATUS_VALUES.includes(statusParam as SupportTicketStatus)
    ? (statusParam as SupportTicketStatus)
    : null;

  const tickets = await prisma.supportTicket.findMany({
    where: status ? { status } : undefined,
    include: {
      openedBy: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      openedBy: ticket.openedBy,
      updatedAt: ticket.updatedAt.toISOString(),
      lastMessagePreview: ticket.messages[0] ? previewMessage(ticket.messages[0].body) : null,
    })),
  });
}

export const GET = withApiErrorHandling(getHandler);
