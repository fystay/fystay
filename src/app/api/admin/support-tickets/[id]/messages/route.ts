import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { createTicketMessage } from "@/app/api/support-tickets/route";
import { withApiErrorHandling } from "@/lib/apiError";

const replySchema = z.object({
  body: z.string().trim().min(1, "Write a reply first.").max(4000, "Message is too long."),
});

/**
 * An admin's reply, acting in a support capacity - isAdminReply: true, and
 * per nextStatusAfterMessage this never reopens a RESOLVED/CLOSED ticket on
 * its own, so an admin can leave a closing note and mark it resolved in the
 * same visit without the reply itself flipping it back open.
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = replySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const message = await createTicketMessage(id, session.user.id, parsed.data.body, true);
  if (!message) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      message: {
        id: message.id,
        body: message.body,
        isAdminReply: true,
        createdAt: message.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}

export const POST = withApiErrorHandling(postHandler);
