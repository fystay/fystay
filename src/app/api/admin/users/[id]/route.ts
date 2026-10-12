import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ADMIN_DELETION_BLOCK_MESSAGES, anonymizeAccount, findAccountDeletionBlocks } from "@/lib/accountDeletion";
import { getUserDetailForAdmin } from "@/lib/adminUserLookup";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * "What's going on with this account" for support - role, verification/2FA
 * state, recent bookings/listings, referral info. Not a data export (that's
 * a separate self-service feature already) - just enough for a support
 * conversation.
 */
async function getHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await getUserDetailForAdmin(id);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user });
}

export const GET = withApiErrorHandling(getHandler);

const deleteSchema = z.object({
  // Typed by the admin in the confirmation dialog - checked here too, so a
  // stray request can't delete an account.
  confirm: z.literal("DELETE"),
  reason: z.string().trim().max(1000).optional(),
});

/**
 * Admin account deletion: the same anonymize-in-place as self-service
 * deletion (see accountDeletion.ts) - personal details are scrubbed and
 * sign-in stops, while bookings, payments, reviews and messages stay as
 * the record other people and FYStay's accounts rely on. Refused for the
 * same reasons self-service deletion is, and never for an admin.
 */
async function deleteHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, deletedAt: true } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (user.deletedAt) return NextResponse.json({ error: "This account is already deleted." }, { status: 409 });
  if (user.role === "ADMIN" || user.id === session.user.id) {
    return NextResponse.json({ error: "Admin accounts can't be deleted here." }, { status: 400 });
  }

  const blocks = await findAccountDeletionBlocks(prisma, id);
  if (blocks.length > 0) {
    return NextResponse.json(
      { error: blocks.map((b) => ADMIN_DELETION_BLOCK_MESSAGES[b]).join(" "), blocks },
      { status: 409 },
    );
  }

  await anonymizeAccount(prisma, id);
  await prisma.adminAuditEvent.create({
    data: { actorId: session.user.id, action: "USER_DELETED", targetUserId: id, note: parsed.data.reason || null },
  });
  return NextResponse.json({ deleted: true });
}

export const DELETE = withApiErrorHandling(deleteHandler);
