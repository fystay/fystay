import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { normalizePromoCode } from "@/lib/promoCode";
import { withApiErrorHandling } from "@/lib/apiError";

const createPromoCodeSchema = z
  .object({
    code: z.string().min(3).max(40),
    description: z.string().max(300).optional(),
    discountType: z.enum(["PERCENT", "FIXED"]),
    discountValue: z.number().int().min(1),
    maxRedemptions: z.number().int().min(1).optional(),
    expiresAt: z.string().optional(),
  })
  .refine((data) => data.discountType !== "PERCENT" || data.discountValue <= 100, {
    message: "A percentage discount can't exceed 100",
    path: ["discountValue"],
  });

/** Platform-wide marketing codes - created only by an ADMIN, never a host (see PromoCode's own schema comment). */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createPromoCodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const code = normalizePromoCode(parsed.data.code);
  const existing = await prisma.promoCode.findUnique({ where: { code } });
  if (existing) {
    return NextResponse.json(
      { error: "A promo code with this code already exists" },
      { status: 409 },
    );
  }

  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
  }

  const promoCode = await prisma.promoCode.create({
    data: {
      code,
      description: parsed.data.description?.trim() || null,
      discountType: parsed.data.discountType,
      discountValue: parsed.data.discountValue,
      maxRedemptions: parsed.data.maxRedemptions ?? null,
      expiresAt,
    },
  });

  return NextResponse.json({ promoCode }, { status: 201 });
}

export const POST = withApiErrorHandling(postHandler);
