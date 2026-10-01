import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { previewMessage } from "@/lib/messaging";
import { nextStatusAfterMessage } from "@/lib/supportTickets";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * Adds a message to an existing ticket and applies whatever status change
 * that implies (see nextStatusAfterMessage) in one transaction - shared
 * between the opener's own reply endpoint and the admin reply endpoint, the
 * same way conversations/route.ts's createMessage is shared with its own
 * reply route. Returns null if the ticket doesn't exist.
 */
export async function createTicketMessage(
  ticketId: string,
  senderId: string,
  body: string,
  isAdminReply: boolean,
) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { status: true },
  });
  if (!ticket) return null;

  const [message] = await prisma.$transaction([
    prisma.supportTicketMessage.create({ data: { ticketId, senderId, body, isAdminReply } }),
    prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: nextStatusAfterMessage(ticket.status, isAdminReply) },
    }),
  ]);
  return message;
}

const openTicketSchema = z.object({
  subject: z.string().trim().min(1, "Give your ticket a subject.").max(200, "Subject is too long."),
  body: z.string().trim().min(1, "Describe the issue first.").max(4000, "Message is too long."),
  bookingId: z.string().min(1).optional(),
  aboutUserId: z.string().min(1).optional(),
});

/**
 * Opens a general-purpose support ticket - the escalation path for anything
 * that doesn't fit PaymentDispute (Stripe-chargeback-specific) or
 * Conversation/Message (guest-host only, no admin visibility). Any signed-in
 * role can open one; the first message is written in the same transaction so
 * a ticket is never created empty.
 */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Lower volume than guest-host messaging (this is a support escalation,
  // not a chat surface), so a tighter cap than the 30/10min conversations
  // use is appropriate while still leaving comfortable room for someone
  // legitimately following up on more than one issue.
  const rateLimit = await checkRateLimit({
    key: `support-tickets:open:${session.user.id}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const parsed = openTicketSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { subject, body, bookingId, aboutUserId } = parsed.data;

  if (bookingId) {
    // Only a booking this user actually has a stake in (as the guest, or as
    // the host of the listing it's against) can be attached - otherwise
    // this would let anyone reference an arbitrary booking id as "context"
    // support has to untangle.
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { guestId: true, listing: { select: { hostId: true } } },
    });
    if (!booking || (booking.guestId !== session.user.id && booking.listing.hostId !== session.user.id)) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
  }

  if (aboutUserId) {
    const aboutUser = await prisma.user.findUnique({ where: { id: aboutUserId }, select: { id: true } });
    if (!aboutUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
  }

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.supportTicket.create({
      data: {
        subject,
        openedById: session.user.id,
        bookingId: bookingId ?? null,
        aboutUserId: aboutUserId ?? null,
      },
    });
    await tx.supportTicketMessage.create({
      data: { ticketId: created.id, senderId: session.user.id, body, isAdminReply: false },
    });
    return created;
  });

  return NextResponse.json({ ticket }, { status: 201 });
}

/** The current user's own tickets - every one they opened, newest activity first. */
async function getHandler() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tickets = await prisma.supportTicket.findMany({
    where: { openedById: session.user.id },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      updatedAt: ticket.updatedAt.toISOString(),
      lastMessagePreview: ticket.messages[0] ? previewMessage(ticket.messages[0].body) : null,
    })),
  });
}

export const POST = withApiErrorHandling(postHandler);
export const GET = withApiErrorHandling(getHandler);
