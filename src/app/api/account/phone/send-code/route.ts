import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rateLimit";
import {
  CODE_TTL_SECONDS,
  PhoneVerificationError,
  RESEND_COOLDOWN_SECONDS,
  isPhoneVerificationConfigured,
  normalizePhoneInput,
  phoneRateLimitKey,
  sendVerificationCode,
} from "@/lib/phoneVerification";
import { withApiErrorHandling } from "@/lib/apiError";

const sendCodeSchema = z.object({ phone: z.string().min(1).max(32) });

/**
 * Sends a Twilio Verify code by SMS. The limits guard against one account
 * (or several, from one place, or aimed at one number) running up SMS
 * charges or spamming someone's phone: a short resend cooldown, then hourly
 * caps per account, per number and per IP. Twilio adds its own per-number
 * limit and fraud checks on top.
 */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isPhoneVerificationConfigured()) {
    return NextResponse.json({ error: "Phone verification isn't switched on yet." }, { status: 501 });
  }

  const body = await request.json().catch(() => null);
  const parsed = sendCodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your mobile number." }, { status: 400 });
  }
  const phone = normalizePhoneInput(parsed.data.phone);
  if (!phone) {
    return NextResponse.json(
      { error: "Enter a mobile number like 07911 123456, or with its country code, e.g. +33 6 12 34 56 78." },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { phone: true, phoneVerifiedAt: true },
  });
  if (user.phoneVerifiedAt && user.phone === phone) {
    return NextResponse.json({ error: "That number is already verified on your account." }, { status: 409 });
  }

  const limits = [
    { key: `phone-verify-cooldown:${session.user.id}`, limit: 1, windowMs: RESEND_COOLDOWN_SECONDS * 1000 },
    { key: `phone-verify-send:${session.user.id}`, limit: 5, windowMs: 60 * 60 * 1000 },
    { key: `phone-verify-number:${phoneRateLimitKey(phone)}`, limit: 5, windowMs: 60 * 60 * 1000 },
    { key: `phone-verify-ip:${clientIp(request)}`, limit: 15, windowMs: 60 * 60 * 1000 },
  ];
  for (const params of limits) {
    const limit = await checkRateLimit(params);
    if (!limit.allowed) return rateLimitedResponse(limit);
  }

  try {
    await sendVerificationCode(phone);
  } catch (error) {
    if (error instanceof PhoneVerificationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  return NextResponse.json({
    sent: true,
    phone,
    expiresInSeconds: CODE_TTL_SECONDS,
    resendInSeconds: RESEND_COOLDOWN_SECONDS,
  });
}

export const POST = withApiErrorHandling(postHandler);
