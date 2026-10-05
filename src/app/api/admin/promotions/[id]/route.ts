import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/apiError";
import { promotionPhase } from "@/lib/listingPromotions";

const updateSchema = z.object({ action: z.literal("end") });

/**
 * Ends a live or scheduled Spotlight placement now (for example, a listing
 * that breaks the rules, or a host who asked to stop). The listing leaves
 * the Spotlight row immediately. Any refund is a separate decision, made in
 * the Stripe Dashboard against the placement's payment.
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

  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const promotion = await prisma.listingPromotion.findUnique({ where: { id } });
  if (!promotion) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const now = new Date();
  const phase = promotionPhase(promotion, now);
  if (phase !== "live" && phase !== "scheduled") {
    return NextResponse.json({ error: "Only a live or scheduled placement can be ended." }, { status: 409 });
  }

  await prisma.listingPromotion.update({
    where: { id },
    data: {
      endedEarlyAt: now,
      endsAt: now,
      // A placement that hadn't started yet ends without ever running.
      ...(phase === "scheduled" && { startsAt: now }),
    },
  });
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiErrorHandling(patchHandler);
