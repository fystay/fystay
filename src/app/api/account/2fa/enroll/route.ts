import { NextResponse } from "next/server";
import { VERIFY_EMAIL_MESSAGE } from "@/lib/emailVerification";
import QRCode from "qrcode";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildTotpUri, generateTotpSecret } from "@/lib/twoFactor";
import { encryptTwoFactorSecret, isTwoFactorConfigured } from "@/lib/twoFactorCrypto";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * Starts (or restarts) 2FA enrollment: generates a fresh secret, stores it
 * encrypted, but does NOT enable 2FA yet - twoFactorEnabledAt only gets set
 * by POST .../verify once the user proves they can actually generate a
 * valid code, so scanning the QR and closing the tab never locks anyone
 * out of an account they can't yet produce codes for. Calling this again
 * before verifying just replaces the pending secret - no separate "cancel"
 * endpoint needed.
 */
async function postHandler() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTwoFactorConfigured()) {
    return NextResponse.json(
      { error: "Two-factor authentication isn't available right now." },
      { status: 503 },
    );
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { email: true, twoFactorEnabledAt: true, emailVerifiedAt: true },
  });
  // The same reasoning as connecting Google: a code set up on an address
  // nobody has proven would lock the real owner out after they reset the
  // password.
  if (!user.emailVerifiedAt) {
    return NextResponse.json({ error: VERIFY_EMAIL_MESSAGE }, { status: 403 });
  }
  if (user.twoFactorEnabledAt) {
    return NextResponse.json({ error: "Two-factor authentication is already enabled" }, { status: 409 });
  }

  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { twoFactorSecretCiphertext: encryptTwoFactorSecret(secret) },
  });

  const otpauthUri = buildTotpUri(secret, user.email);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);

  return NextResponse.json({
    secret,
    otpauthUri,
    qrCodeDataUrl,
  });
}

export const POST = withApiErrorHandling(postHandler);
