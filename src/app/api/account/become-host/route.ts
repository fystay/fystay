import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Lets a signed-in guest start hosting on the same account - without it the
 * only way to become a host was registering a second account as one, which a
 * Google sign-up or anyone reusing their email can't do. Guest-only: an
 * admin keeps their role. The session picks up the new role on its next read
 * (the jwt callback in src/auth.ts re-reads it every request).
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.user.updateMany({
    where: { id: session.user.id, role: "GUEST" },
    data: { role: "HOST" },
  });

  return NextResponse.json({ ok: true });
}
