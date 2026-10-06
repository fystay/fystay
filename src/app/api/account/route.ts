import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { anonymizeAccount, findAccountDeletionBlocks } from "@/lib/accountDeletion";
import { withApiErrorHandling } from "@/lib/apiError";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";

const deleteAccountSchema = z.object({ currentPassword: z.string().max(200).optional() });

/**
 * Self-service account deletion - see accountDeletion.ts for exactly what
 * this does and doesn't touch. An account with a password must give it
 * again, so a session left open on someone else's device can't erase the
 * account. A Google-only account has no password to ask for.
 */
async function deleteHandler(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit({
    key: `account-delete:${session.user.id}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.allowed) return rateLimitedResponse(limit);

  const raw = await request.text();
  const parsed = deleteAccountSchema.safeParse(raw ? JSON.parse(raw) : {});
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });
  if (user.passwordHash) {
    const password = parsed.data.currentPassword ?? "";
    if (!password || !(await bcrypt.compare(password, user.passwordHash))) {
      return NextResponse.json(
        { error: password ? "That password isn't right." : "Enter your password to delete your account." },
        { status: 400 },
      );
    }
  }

  const blocks = await findAccountDeletionBlocks(prisma, session.user.id);
  if (blocks.length > 0) {
    return NextResponse.json({ error: "Cannot delete this account yet", blocks }, { status: 409 });
  }

  await anonymizeAccount(prisma, session.user.id);
  return NextResponse.json({ deleted: true });
}

export const DELETE = withApiErrorHandling(deleteHandler);
