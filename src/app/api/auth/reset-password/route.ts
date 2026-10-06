import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashResetToken, isResetTokenValid } from "@/lib/passwordReset";
import { withApiErrorHandling } from "@/lib/apiError";

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(72, "Password is too long."),
});

async function postHandler(request: Request) {
  const body = await request.json();
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(parsed.data.token) },
  });

  if (!record || !isResetTokenValid(record)) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired. Request a new one." },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  const used = await prisma.$transaction(async (tx) => {
    // Claim the link atomically: of two submissions racing on the same
    // link, only the one that flips usedAt from null gets to set a password.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) return false;
    // Any other reset link still sitting in this person's inbox stops
    // working too - the password it was meant to replace is gone.
    await tx.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    // Resetting a password is itself a signal the old one may have been
    // compromised - bumping sessionVersion here signs out every session
    // that was established under it (see src/lib/sessionRevocation.ts),
    // including on a device the real owner no longer has, not just this
    // one's browser.
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    return true;
  });
  if (!used) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired. Request a new one." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}

export const POST = withApiErrorHandling(postHandler);
