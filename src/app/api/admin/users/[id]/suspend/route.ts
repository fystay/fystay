import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";

const suspendUserSchema = z.object({
  suspended: z.boolean(),
  // Only meaningful when suspending (suspended: true) - ignored, and the
  // stored reason cleared, when unsuspending. See the schema comment on
  // User.suspendedReason.
  reason: z.string().trim().max(1000).optional(),
});

/**
 * Admin-only account suspension - the backend half of the top-priority
 * support gap this app had no way to act on before: a bad host or guest
 * account, blocked from authenticating entirely (see AccountSuspendedError
 * in src/auth.ts) until an admin lifts it.
 */
async function patchHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = suspendUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // Safety guard: this route must never be usable to lock out another
  // admin (or an admin's own account, since they're always their own
  // target's peer role here) - an admin who genuinely needs demoting or
  // removing does that through a different, more deliberate path, not a
  // one-field PATCH.
  if (parsed.data.suspended && user.role === "ADMIN") {
    return NextResponse.json(
      { error: "Cannot suspend an admin account" },
      { status: 400 },
    );
  }

  const updated = await prisma.user.update({
    where: { id },
    data: parsed.data.suspended
      ? {
          suspendedAt: new Date(),
          suspendedReason: parsed.data.reason || null,
          // Kicks this account out of any live session immediately rather
          // than merely blocking its *next* login attempt - see
          // src/lib/sessionRevocation.ts. Not bumped on unsuspend: there's
          // no live session to kill in that direction, only new logins to
          // allow again.
          sessionVersion: { increment: 1 },
        }
      : { suspendedAt: null, suspendedReason: null },
  });

  return NextResponse.json({
    user: { id: updated.id, suspendedAt: updated.suspendedAt, suspendedReason: updated.suspendedReason },
  });
}

export const PATCH = withApiErrorHandling(patchHandler);
