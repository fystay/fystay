import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";

const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
});

/**
 * Display name only - this deliberately does not touch email (its own
 * verified change flow, see /api/account/email/request) or phone (owned
 * end to end by the Twilio verification flow in /api/account/phone/*,
 * which sets it together with phoneVerifiedAt - a generic profile PATCH
 * accepting phone too would let someone silently overwrite a verified
 * number with an unverified one).
 */
async function patchHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await checkRateLimit({
    key: `account-profile:${session.user.id}`,
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.allowed) return rateLimitedResponse(limit);

  const body = await request.json();
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name },
  });

  return NextResponse.json({ ok: true });
}

export const PATCH = withApiErrorHandling(patchHandler);
