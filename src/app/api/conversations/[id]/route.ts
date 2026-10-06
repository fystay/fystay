import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isConversationParticipant, otherParticipant } from "@/lib/messaging";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * A conversation's full message history, oldest first. Reading it also
 * marks every message the *other* participant sent as read - there's no
 * separate "mark as read" action anywhere in the UI, the same way opening
 * an email thread marks it read.
 */
async function getHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      listing: { select: { id: true, title: true, photos: true } },
      guest: { select: { id: true, name: true } },
      host: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, createdAt: true, senderId: true },
      },
    },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (!isConversationParticipant(conversation, session.user.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.message.updateMany({
    where: { conversationId: id, senderId: { not: session.user.id }, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      listing: { id: conversation.listing.id, title: conversation.listing.title },
      counterparty: otherParticipant(conversation, session.user.id),
      messages: conversation.messages.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        fromMe: m.senderId === session.user.id,
      })),
    },
  });
}

export const GET = withApiErrorHandling(getHandler);
