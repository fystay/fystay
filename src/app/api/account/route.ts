import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { anonymizeAccount, findAccountDeletionBlocks } from "@/lib/accountDeletion";
import { withApiErrorHandling } from "@/lib/apiError";

/** Self-service account deletion - see accountDeletion.ts for exactly what this does and doesn't touch. */
async function deleteHandler() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const blocks = await findAccountDeletionBlocks(prisma, session.user.id);
  if (blocks.length > 0) {
    return NextResponse.json({ error: "Cannot delete this account yet", blocks }, { status: 409 });
  }

  await anonymizeAccount(prisma, session.user.id);
  return NextResponse.json({ deleted: true });
}

export const DELETE = withApiErrorHandling(deleteHandler);
