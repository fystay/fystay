import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";

// Deliberately excludes code/discountType/discountValue - every issued
// booking has already snapshotted its own discount (see
// Booking.promoDiscountCents), so changing a code's value after the fact
// would only confuse admins reading past bookings against a code that no
// longer says what it paid out. An admin who wants a different discount
// creates a new code instead.
const updatePromoCodeSchema = z.object({
  active: z.boolean().optional(),
  description: z.string().max(300).nullable().optional(),
  maxRedemptions: z.number().int().min(1).nullable().optional(),
  expiresAt: z.string().nullable().optional(),
});

async function patchHandler(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const promoCode = await prisma.promoCode.findUnique({ where: { id } });
  if (!promoCode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updatePromoCodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  let expiresAt: Date | null | undefined;
  if (parsed.data.expiresAt !== undefined) {
    expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return NextResponse.json({ error: "Invalid expiry date" }, { status: 400 });
    }
  }

  const updated = await prisma.promoCode.update({
    where: { id },
    data: {
      ...(parsed.data.active !== undefined && { active: parsed.data.active }),
      ...(parsed.data.description !== undefined && {
        description: parsed.data.description?.trim() || null,
      }),
      ...(parsed.data.maxRedemptions !== undefined && {
        maxRedemptions: parsed.data.maxRedemptions,
      }),
      ...(expiresAt !== undefined && { expiresAt }),
    },
  });

  return NextResponse.json({ promoCode: updated });
}

export const PATCH = withApiErrorHandling(patchHandler);
