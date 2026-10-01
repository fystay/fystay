import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { checkVerificationCode, isPhoneVerificationConfigured, isValidE164Phone } from "@/lib/phoneVerification";
import { withApiErrorHandling } from "@/lib/apiError";

const verifyCodeSchema = z.object({
  phone: z.string().min(1),
  code: z.string().min(1).max(10),
});

async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isPhoneVerificationConfigured()) {
    return NextResponse.json({ error: "Phone verification is not available right now" }, { status: 501 });
  }

  const body = await request.json();
  const parsed = verifyCodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const phone = parsed.data.phone.trim();
  if (!isValidE164Phone(phone)) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  // A guess-the-code attack is the thing to guard against here, not
  // Twilio spend - a much tighter window than send-code's.
  const limit = await checkRateLimit({
    key: `phone-verify-check:${session.user.id}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }

  const approved = await checkVerificationCode(phone, parsed.data.code.trim());
  if (!approved) {
    return NextResponse.json({ error: "That code is incorrect or has expired" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { phone, phoneVerifiedAt: new Date() },
  });

  return NextResponse.json({ verified: true });
}

export const POST = withApiErrorHandling(postHandler);
