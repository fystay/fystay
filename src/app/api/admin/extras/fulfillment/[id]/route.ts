import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { confirmBookingExtraFulfillment, fulfillBookingExtra } from "@/lib/tripExtraFulfillment";
import { withApiErrorHandling } from "@/lib/apiError";

// "retry" re-runs the provider's adapter (only a FAILED or stuck handoff
// can be claimed - see fulfillBookingExtra); "confirm" records the
// provider's own confirmation, with their booking reference if they gave one.
const fulfillmentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry") }),
  z.object({
    action: z.literal("confirm"),
    reference: z.string().trim().max(200, "Keep the reference under 200 characters.").optional(),
  }),
]);

async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = fulfillmentActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const extra = await prisma.bookingExtra.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!extra) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (extra.status !== "PAID") {
    return NextResponse.json({ error: "Only paid extras can be fulfilled" }, { status: 409 });
  }

  if (parsed.data.action === "confirm") {
    const confirmed = await confirmBookingExtraFulfillment(id, parsed.data.reference || null);
    if (!confirmed) {
      return NextResponse.json(
        { error: "Only a sent or failed handoff can be marked confirmed - refresh the page" },
        { status: 409 },
      );
    }
    return NextResponse.json({ fulfillmentStatus: "CONFIRMED" });
  }

  const outcome = await fulfillBookingExtra(id, { retry: true });
  if (outcome.kind === "skipped") {
    return NextResponse.json(
      { error: "This handoff isn't retryable right now - refresh the page" },
      { status: 409 },
    );
  }
  return NextResponse.json({ fulfillmentStatus: outcome.status });
}

export const POST = withApiErrorHandling(postHandler);
