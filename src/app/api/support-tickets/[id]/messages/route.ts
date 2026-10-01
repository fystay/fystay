import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isTicketOpener } from "@/lib/supportTickets";
import { createTicketMessage } from "@/app/api/support-tickets/route";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";

const replySchema = z.object({
  body: z.string().trim().min(1, "Write a message first.").max(4000, "Message is too long."),
});

/**
 * A reply from the ticket's own opener - never an admin acting in a support
 * capacity, which always replies through the separate
 * /api/admin/support-tickets/[id]/messages endpoint instead, so this route
 * can unconditionally treat every message it creates as an opener message
 * (isAdminReply: false) and let it reopen a RESOLVED/CLOSED ticket, per
 * nextStatusAfterMessage.
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit({
    key: `support-tickets:reply:${session.user.id}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const parsed = replySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const ticket = await prisma.supportTicket.findUnique({ where: { id }, select: { openedById: true } });
  if (!ticket) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isTicketOpener(ticket, session.user.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const message = await createTicketMessage(id, session.user.id, parsed.data.body, false);
  if (!message) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      message: {
        id: message.id,
        body: message.body,
        isAdminReply: false,
        createdAt: message.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}

export const POST = withApiErrorHandling(postHandler);
