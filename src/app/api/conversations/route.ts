import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { otherParticipant, previewMessage } from "@/lib/messaging";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * Creates a Message and bumps its Conversation's updatedAt in one
 * transaction, so a reply always moves that thread back to the top of both
 * participants' inbox - shared between starting a new conversation (below)
 * and replying to an existing one (/api/conversations/[id]/messages).
 */
export async function createMessage(conversationId: string, senderId: string, body: string) {
  const [message] = await prisma.$transaction([
    prisma.message.create({ data: { conversationId, senderId, body } }),
    prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ]);
  return message;
}

const startConversationSchema = z.object({
  listingId: z.string().min(1),
  body: z.string().trim().min(1, "Write a message first.").max(4000, "Message is too long."),
  // Only read (and required) when the sender is the listing's host - a
  // guest's own id is always themselves, never something the client gets
  // to choose.
  guestId: z.string().min(1).optional(),
});

/**
 * Starts a conversation about a listing, or - since Conversation is unique
 * per (listing, guest) - reuses the existing one and just adds a message to
 * it. A guest can start one with any listing's host; a host can only reply
 * into one with a guest who has actually booked that listing, never an
 * arbitrary user id, which would otherwise make this an unsolicited-message
 * vector.
 */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Shares one counter with the reply endpoint (same key prefix, same
  // limit) - see that route's own comment. Starting a new conversation and
  // replying to one both send a Message, so both should count against the
  // same budget rather than doubling the effective cap.
  const rateLimit = await checkRateLimit({
    key: `messages:send:${session.user.id}`,
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const parsed = startConversationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const listing = await prisma.listing.findUnique({
    where: { id: parsed.data.listingId },
    select: { id: true, hostId: true, published: true, suspendedAt: true },
  });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  let guestId: string;
  if (session.user.role === "HOST") {
    if (listing.hostId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!parsed.data.guestId) {
      return NextResponse.json({ error: "guestId is required" }, { status: 400 });
    }
    const hasBooking = await prisma.booking.findFirst({
      where: { listingId: listing.id, guestId: parsed.data.guestId },
      select: { id: true },
    });
    if (!hasBooking) {
      return NextResponse.json(
        { error: "You can only message guests who have booked this listing." },
        { status: 403 },
      );
    }
    guestId = parsed.data.guestId;
  } else {
    if (listing.hostId === session.user.id) {
      return NextResponse.json(
        { error: "You can't message yourself about your own listing." },
        { status: 400 },
      );
    }
    // A hidden or suspended listing only takes messages from guests who
    // already booked it - nobody new can reach a host through it.
    if (!listing.published || listing.suspendedAt) {
      const hasBooked = await prisma.booking.findFirst({
        where: { listingId: listing.id, guestId: session.user.id },
        select: { id: true },
      });
      if (!hasBooked) {
        return NextResponse.json({ error: "Listing not found" }, { status: 404 });
      }
    }
    guestId = session.user.id;
  }

  const conversation = await prisma.conversation.upsert({
    where: { listingId_guestId: { listingId: listing.id, guestId } },
    create: { listingId: listing.id, guestId, hostId: listing.hostId },
    update: {},
  });

  const message = await createMessage(conversation.id, session.user.id, parsed.data.body);

  return NextResponse.json({ conversationId: conversation.id, message }, { status: 201 });
}

/**
 * The current user's inbox - every conversation where they're either side,
 * newest activity first, with just enough of the last message to render a
 * list row (see previewMessage) and an unread count computed from messages
 * the *other* participant sent that this viewer hasn't opened yet.
 */
async function getHandler() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const conversations = await prisma.conversation.findMany({
    where: { OR: [{ guestId: userId }, { hostId: userId }] },
    include: {
      listing: { select: { id: true, title: true, photos: true } },
      guest: { select: { id: true, name: true } },
      host: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  const unreadByConversation = await prisma.message.groupBy({
    by: ["conversationId"],
    where: {
      conversationId: { in: conversations.map((c) => c.id) },
      senderId: { not: userId },
      readAt: null,
    },
    _count: { _all: true },
  });
  const unreadCounts = new Map(unreadByConversation.map((row) => [row.conversationId, row._count._all]));

  return NextResponse.json({
    conversations: conversations.map((conversation) => {
      const lastMessage = conversation.messages[0];
      return {
        id: conversation.id,
        listing: {
          id: conversation.listing.id,
          title: conversation.listing.title,
          photo: conversation.listing.photos[0] ?? null,
        },
        counterparty: otherParticipant(conversation, userId),
        lastMessagePreview: lastMessage ? previewMessage(lastMessage.body) : null,
        lastMessageAt: (lastMessage?.createdAt ?? conversation.updatedAt).toISOString(),
        unreadCount: unreadCounts.get(conversation.id) ?? 0,
      };
    }),
  });
}

export const POST = withApiErrorHandling(postHandler);
export const GET = withApiErrorHandling(getHandler);
